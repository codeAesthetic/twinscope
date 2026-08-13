import { compareContracts, looksLikeContract, parseContract, type ApiFinding } from './contract';
import { keyOf, looksLikeHar, pairEntries, parseHar, type HarEntry } from './har';
import {
  diffJson,
  DEFAULT_JSON_OPTIONS,
  type JsonDiffOptions,
  type JsonRow,
} from '../json/jsonDiff';
import { radarFrom, ratioScore } from '../radar';
import { EngineInputError } from '../types';
import type { DiffEngine, DiffResult, InputRef } from '../types';

/**
 * API comparison (v0.3.1, MD §17 / A8).
 *
 * Three inputs, one engine, and a **verdict**. A structural diff of two API payloads
 * answers "what bytes changed"; this answers "will a consumer break", which is the
 * only question anyone opens two API responses to ask.
 *
 *  - **Two HARs** → entries paired on method and path (see `har.ts` for why not on
 *    the URL), then status, headers and body compared as three separate answers.
 *  - **Two OpenAPI documents** → breaking-change detection, every finding naming the
 *    rule that produced it (`contract.ts`).
 *  - **Two saved response bodies** → the JSON core, plus the `errors` array a GraphQL
 *    response carries, which is a different thing from a changed `data`.
 *
 * **It does not fetch.** Everything here is a file the user chose. A `--url` mode is
 * the network decision's (plan §6.3.0), and the shape is built for it: fetching would
 * arrive as a host method producing the same `HarEntry`s, not as a rewrite.
 */

export type ApiMode = 'har' | 'contract' | 'response';

export type EntryVerdict = 'breaking' | 'changed' | 'unchanged';

export interface HeaderChange {
  name: string;
  before: string | undefined;
  after: string | undefined;
}

export interface ApiEntryRow {
  key: string;
  method: string;
  path: string;
  presence: 'both' | 'before-only' | 'after-only';
  status: { before: number | undefined; after: number | undefined };
  headers: {
    added: HeaderChange[];
    removed: HeaderChange[];
    changed: HeaderChange[];
    /** Volatile headers whose change was suppressed, and counted (Rule 3). */
    suppressed: number;
  };
  /** Structural rows for the response body, when both sides are JSON. */
  body: { rows: JsonRow[]; added: number; removed: number; changed: number } | null;
  bodyNote: string | undefined;
  verdict: EntryVerdict;
}

export interface ApiDiffData {
  mode: ApiMode;
  entries: ApiEntryRow[];
  findings: ApiFinding[];
  /** Only for a contract pair: the two document versions. */
  versions?: { before: string; after: string };
}

export interface ApiDiffOptions extends JsonDiffOptions {
  /**
   * Headers that change on every capture. Suppressed by default and counted — a
   * `date` header differing is not news, and reporting it once per entry buries
   * everything that is.
   */
  volatileHeaders: string[];
  /** Compare request bodies as well as responses. Off: most APIs echo little. */
  compareRequests: boolean;
}

export const DEFAULT_VOLATILE_HEADERS = [
  'date',
  'age',
  'etag',
  'set-cookie',
  'cookie',
  'content-length',
  'request-id',
  'x-request-id',
  'x-amzn-requestid',
  'x-correlation-id',
  'traceparent',
  'x-runtime',
  'server-timing',
  'expires',
  'last-modified',
  'authorization',
];

export const DEFAULT_API_OPTIONS: ApiDiffOptions = {
  ...DEFAULT_JSON_OPTIONS,
  volatileHeaders: DEFAULT_VOLATILE_HEADERS,
  compareRequests: false,
};

const FALLBACK = { fallbackEngineId: 'json', fallbackLabel: 'Compare as JSON' };

/** Which of the three shapes this text is, or null when it is none of them. */
export function apiShapeOf(text: string | undefined): ApiMode | null {
  if (text === undefined || text === '') return null;
  if (looksLikeHar(text)) return 'har';
  if (looksLikeContract(text)) return 'contract';
  return null;
}

function parseJsonBody(text: string | undefined): { value: unknown; ok: boolean } {
  if (text === undefined || text.trim() === '') return { value: undefined, ok: false };
  try {
    return { value: JSON.parse(text), ok: true };
  } catch {
    return { value: undefined, ok: false };
  }
}

function headerDiff(
  before: HarEntry | undefined,
  after: HarEntry | undefined,
  volatile: ReadonlySet<string>,
): ApiEntryRow['headers'] {
  const map = (entry: HarEntry | undefined): Map<string, string> =>
    new Map((entry?.responseHeaders ?? []).map((header) => [header.name, header.value]));

  const left = map(before);
  const right = map(after);
  const headers: ApiEntryRow['headers'] = { added: [], removed: [], changed: [], suppressed: 0 };

  for (const [name, value] of left) {
    const other = right.get(name);
    if (other === undefined) {
      if (volatile.has(name)) headers.suppressed += 1;
      else headers.removed.push({ name, before: value, after: undefined });
      continue;
    }
    if (other === value) continue;
    if (volatile.has(name)) headers.suppressed += 1;
    else headers.changed.push({ name, before: value, after: other });
  }

  for (const [name, value] of right) {
    if (left.has(name)) continue;
    if (volatile.has(name)) headers.suppressed += 1;
    else headers.added.push({ name, before: undefined, after: value });
  }

  return headers;
}

function bodyDiff(
  before: string | undefined,
  after: string | undefined,
  options: ApiDiffOptions,
): { body: ApiEntryRow['body']; note: string | undefined } {
  const left = parseJsonBody(before);
  const right = parseJsonBody(after);

  if (!left.ok && !right.ok) {
    if ((before ?? '') === (after ?? '')) return { body: null, note: undefined };
    return { body: null, note: 'Body changed, but it is not JSON — compare these two as text.' };
  }
  if (!left.ok || !right.ok) {
    return { body: null, note: 'One side has no JSON body, so the bodies cannot be compared.' };
  }

  const { data, stats } = diffJson(left.value, right.value, options);
  return {
    body: {
      rows: data.rows,
      added: stats.added,
      removed: stats.removed,
      changed: stats.changed + stats.typeChanged,
    },
    note: undefined,
  };
}

/**
 * An entry's verdict.
 *
 * `breaking` is claimed only for the two things a HAR can actually prove: an entry
 * that stopped being served, and a success that became a failure. Everything else
 * a capture shows is a change, and calling it breaking would be a guess — the
 * contract path is where verdicts are earned.
 */
function verdictFor(row: Omit<ApiEntryRow, 'verdict'>): EntryVerdict {
  if (row.presence === 'before-only') return 'breaking';
  const before = row.status.before ?? 0;
  const after = row.status.after ?? 0;
  if (before < 400 && after >= 400) return 'breaking';
  if (before !== after) return 'changed';
  if (row.headers.added.length + row.headers.removed.length + row.headers.changed.length > 0) {
    return 'changed';
  }
  if (row.body !== null && row.body.added + row.body.removed + row.body.changed > 0) {
    return 'changed';
  }
  if (row.bodyNote !== undefined) return 'changed';
  return row.presence === 'after-only' ? 'changed' : 'unchanged';
}

function textOf(input: InputRef): string {
  if (input.text !== undefined) return input.text;
  throw new Error(`${input.name} has no readable content.`);
}

export const apiEngine: DiffEngine<ApiDiffOptions, ApiDiffData> = {
  // Above `json` (which is 40 in the catalog's ordering by priority) so a HAR pair
  // gets the API view; a plain JSON pair never reaches here, since `canHandle`
  // requires the kind detection has already decided this is an API document.
  meta: { id: 'api', label: 'API diff', priority: 55 },

  canHandle: (a, b) => a.kind === 'api' && b.kind === 'api',

  defaultOptions: () => ({
    ...DEFAULT_API_OPTIONS,
    volatileHeaders: [...DEFAULT_VOLATILE_HEADERS],
    ignorePaths: [],
  }),

  async compare(a, b, options, ctx): Promise<DiffResult<ApiDiffData>> {
    const startedAt = Date.now();
    ctx.progress(10, 'reading');

    const beforeText = textOf(a);
    const afterText = textOf(b);
    const shape = apiShapeOf(beforeText) ?? apiShapeOf(afterText) ?? 'response';
    const notes: string[] = [];

    if (apiShapeOf(beforeText) !== apiShapeOf(afterText)) {
      throw new EngineInputError(
        `${a.name} and ${b.name} are different kinds of API document (${apiShapeOf(beforeText) ?? 'response'} against ${apiShapeOf(afterText) ?? 'response'}).`,
        FALLBACK,
      );
    }

    if (shape === 'contract') {
      ctx.progress(45, 'reading contracts');
      const before = parseContract(JSON.parse(beforeText) as unknown);
      const after = parseContract(JSON.parse(afterText) as unknown);
      const findings = compareContracts(before, after);
      const breaking = findings.filter((finding) => finding.verdict === 'breaking').length;

      notes.push(
        `Compared ${before.operations.size} against ${after.operations.size} operations, using the first 2xx response as each one's contract.`,
        'Every finding names the rule that produced it. A change compatibility depends on something the document does not state is reported as notable, never asserted as safe.',
        'External `$ref`s are not followed — that would mean reading a file you did not choose.',
      );

      ctx.progress(100, 'done');
      return {
        engineId: 'api',
        summary: {
          added: findings.filter((finding) => finding.rule.endsWith('-added')).length,
          removed: findings.filter((finding) => finding.rule.endsWith('-removed')).length,
          modified: findings.filter(
            (finding) => !finding.rule.endsWith('-added') && !finding.rule.endsWith('-removed'),
          ).length,
          extra: {
            breaking,
            compatible: findings.length - breaking,
            operations: Math.max(before.operations.size, after.operations.size),
          },
          radar: radarFrom({
            structure: ratioScore(
              findings.filter((finding) => finding.rule.startsWith('operation-')).length,
              Math.max(1, before.operations.size),
            ),
            content: ratioScore(findings.length, Math.max(1, before.operations.size) * 4),
            metadata: ratioScore(breaking, Math.max(1, findings.length)),
          }),
        },
        data: {
          mode: 'contract',
          entries: [],
          findings,
          versions: { before: before.version, after: after.version },
        },
        normalizationNotes: notes,
        timings: { ms: Date.now() - startedAt },
      };
    }

    const volatile = new Set(options.volatileHeaders.map((name) => name.toLowerCase()));

    // A `response` pair is one entry with no status and no headers: a saved body
    // carries neither, and inventing a 200 for it would be a fact the file does not
    // contain.
    const pairs =
      shape === 'har'
        ? pairEntries(parseHar(beforeText), parseHar(afterText))
        : [
            {
              key: `${a.name} ↔ ${b.name}`,
              before: syntheticEntry(a.name, beforeText),
              after: syntheticEntry(b.name, afterText),
            },
          ];

    const entries: ApiEntryRow[] = [];
    let suppressed = 0;

    for (let at = 0; at < pairs.length; at += 1) {
      if (ctx.signal.aborted) throw new DOMException('Comparison cancelled', 'AbortError');
      ctx.progress(20 + (at / pairs.length) * 75, 'comparing entries');

      const pair = pairs[at]!;
      const headers = headerDiff(pair.before, pair.after, volatile);
      suppressed += headers.suppressed;

      const { body, note } = bodyDiff(pair.before?.responseBody, pair.after?.responseBody, options);
      const requestBody = options.compareRequests
        ? bodyDiff(pair.before?.requestBody, pair.after?.requestBody, options)
        : { body: null, note: undefined };

      const method = (pair.before ?? pair.after)?.method ?? 'GET';
      const row: Omit<ApiEntryRow, 'verdict'> = {
        key: pair.key,
        method,
        path: pair.key.slice(method.length + 1),
        presence:
          pair.before === undefined
            ? 'after-only'
            : pair.after === undefined
              ? 'before-only'
              : 'both',
        status: { before: pair.before?.status, after: pair.after?.status },
        headers,
        body,
        bodyNote: note ?? requestBody.note,
      };
      entries.push({ ...row, verdict: verdictFor(row) });
    }

    const breaking = entries.filter((entry) => entry.verdict === 'breaking').length;
    // A `changed` entry that is only on one side is already counted as added or
    // removed; counting it here as well would make the three chips sum to more
    // entries than the capture has.
    const changed = entries.filter(
      (entry) => entry.presence === 'both' && entry.verdict === 'changed',
    ).length;
    const bodyChanges = entries.reduce(
      (count, entry) =>
        count + (entry.body?.added ?? 0) + (entry.body?.removed ?? 0) + (entry.body?.changed ?? 0),
      0,
    );

    if (shape === 'har') {
      notes.push(
        `Paired ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'} on method and path, with query parameters reduced to their names — two captures never agree on values or order.`,
      );
    } else {
      notes.push(
        'These are response bodies, not a capture: there is no status and no headers to compare, so only the shape is.',
      );
    }
    if (suppressed > 0) {
      notes.push(
        `Ignored ${suppressed} change${suppressed === 1 ? '' : 's'} in volatile headers (date, request ids, cookies and the rest). They are listed in the options.`,
      );
    }
    if (!options.compareRequests) {
      notes.push('Request bodies were not compared. Turn that on in the toolbar to include them.');
    }

    ctx.progress(100, 'done');

    return {
      engineId: 'api',
      summary: {
        added: entries.filter((entry) => entry.presence === 'after-only').length,
        removed: entries.filter((entry) => entry.presence === 'before-only').length,
        modified: changed,
        extra: { entries: entries.length, breaking, 'body changes': bodyChanges },
        suppressed,
        radar: radarFrom({
          structure: ratioScore(
            entries.filter((entry) => entry.presence !== 'both').length,
            Math.max(1, entries.length),
          ),
          content: ratioScore(changed, Math.max(1, entries.length)),
          metadata: ratioScore(
            entries.filter(
              (entry) =>
                entry.status.before !== entry.status.after ||
                entry.headers.added.length + entry.headers.removed.length > 0,
            ).length,
            Math.max(1, entries.length),
          ),
        }),
      },
      data: { mode: shape, entries, findings: [] },
      normalizationNotes: notes,
      timings: { ms: Date.now() - startedAt },
    };
  },
};

/** A saved body, in the shape the HAR path already knows how to compare. */
function syntheticEntry(name: string, text: string): HarEntry {
  return {
    method: 'BODY',
    url: name,
    key: keyOf('BODY', name),
    status: 0,
    statusText: '',
    requestHeaders: [],
    responseHeaders: [],
    requestBody: undefined,
    responseBody: text,
    mimeType: 'application/json',
  };
}

export type { ApiFinding } from './contract';
export { looksLikeHar } from './har';
export { looksLikeContract } from './contract';
