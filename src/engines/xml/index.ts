import { parseXml, XmlParseError } from './xmlDiff';
import { diffJson, DEFAULT_JSON_OPTIONS } from '../json/jsonDiff';
import { radarFrom, ratioScore } from '../radar';
import { EngineInputError, type DiffEngine, type DiffResult, type InputRef } from '../types';
import type { JsonDiffData, JsonDiffOptions } from '../json/jsonDiff';

export { parseXml, XmlParseError, ATTRIBUTE_PREFIX, TEXT_KEY } from './xmlDiff';
export type { XmlParse } from './xmlDiff';

export type XmlDiffOptions = JsonDiffOptions;
export type XmlDiffData = JsonDiffData;

async function textFor(input: InputRef, read: (path: string) => Promise<string>): Promise<string> {
  if (input.text !== undefined) return input.text;
  if (input.path !== undefined) return read(input.path);
  throw new Error(`${input.name} has no readable content.`);
}

function parse(text: string, label: string): { value: unknown; notes: string[] } {
  try {
    return parseXml(text, label);
  } catch (cause) {
    if (cause instanceof XmlParseError) {
      const where =
        cause.line === undefined ? '' : ` at line ${cause.line}, column ${cause.column ?? 1}`;
      throw new EngineInputError(`${cause.message}${where}.`, {
        fallbackEngineId: 'text',
        fallbackLabel: 'Compare as text',
      });
    }
    throw cause;
  }
}

/**
 * Structural XML comparison (v0.2.4, A3).
 *
 * Like the YAML engine, this is a parser in front of `diffJson`. The one place it
 * diverges from its siblings is the default for `ignoreArrayOrder`:
 *
 * **XML child order is part of the document.** JSON arrays are usually sets in
 * practice — a reordered `roles` list rarely means anything — which is why the JSON
 * engine matches array items by identity by default. An XML document is the
 * opposite: `<step>` elements in a different order describe a different process. So
 * the same core runs with the option inverted, and the user can turn it back on for
 * the documents where order genuinely does not matter.
 */
export const xmlEngine: DiffEngine<XmlDiffOptions, XmlDiffData> = {
  meta: { id: 'xml', label: 'Structural XML diff', priority: 24 },

  canHandle: (a, b) => a.kind === 'xml' && b.kind === 'xml',

  defaultOptions: () => ({
    ...DEFAULT_JSON_OPTIONS,
    ignoreArrayOrder: false,
    ignorePaths: [],
  }),

  async compare(a, b, options, ctx): Promise<DiffResult<XmlDiffData>> {
    const startedAt = Date.now();
    const read = async (path: string): Promise<string> => {
      if (ctx.fs === undefined) throw new Error('No filesystem access was provided.');
      return ctx.fs.readText(path);
    };

    ctx.progress(10, 'reading');
    const [rawA, rawB] = await Promise.all([textFor(a, read), textFor(b, read)]);

    if (ctx.signal.aborted) throw new DOMException('Comparison cancelled', 'AbortError');

    ctx.progress(30, 'parsing');
    const before = parse(rawA, a.name);
    const after = parse(rawB, b.name);

    ctx.progress(55, 'comparing structure');
    const { data, stats, notes } = diffJson(
      before.value,
      after.value,
      options,
      () => ctx.signal.aborted,
    );

    ctx.progress(100, 'done');

    const extra: Record<string, number | string> = { nodes: data.nodes };
    if (stats.typeChanged > 0) {
      extra[`type change${stats.typeChanged === 1 ? '' : 's'}`] = `⚠ ${stats.typeChanged}`;
    }
    const attributes = countAttributeRows(data);
    if (attributes > 0) extra.attributes = attributes;

    return {
      engineId: 'xml',
      summary: {
        added: stats.added,
        removed: stats.removed,
        modified: stats.changed + stats.typeChanged,
        extra,
        suppressed: stats.suppressed,
        // Radar (v0.2.7): a structural walk counts nodes, so Structure is what
        // appeared or vanished and Content is what changed in place. A type change is
        // a fact *about* a value rather than the value itself, so it feeds Metadata.
        radar: radarFrom({
          structure: ratioScore(stats.added + stats.removed, data.nodes),
          content: ratioScore(stats.changed, data.nodes),
          metadata: ratioScore(stats.typeChanged, data.nodes),
        }),
      },
      data,
      // The parse notes are the same two sentences for both sides; only the
      // document-specific ones (comments, namespaces) are worth repeating.
      normalizationNotes: dedupe([...before.notes, ...after.notes, ...notes]),
      timings: { ms: Date.now() - startedAt },
    };
  },
};

/**
 * Changed rows that are attributes rather than elements.
 *
 * Worth its own chip because it answers a question a reader has immediately:
 * "did the structure change, or just an attribute?"
 */
function countAttributeRows(data: XmlDiffData): number {
  return data.rows.filter(
    (row) => row.key?.startsWith('@') === true && row.state !== 'same' && row.state !== 'ign',
  ).length;
}

function dedupe(notes: readonly string[]): string[] {
  return [...new Set(notes)];
}
