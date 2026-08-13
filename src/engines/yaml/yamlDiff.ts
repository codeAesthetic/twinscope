import { isAlias, isMap, isScalar, parseAllDocuments, visit, type Document } from 'yaml';

/**
 * YAML → plain JavaScript values, ready for the JSON structural core (v0.2.3).
 *
 * There is no YAML *diff* in this file, and that is the design: a YAML document
 * and a JSON document are the same thing once parsed, so `diffJson` compares both
 * and the two engines cannot drift apart. What YAML needs is a careful parse.
 */

export interface YamlParse {
  /** The value handed to `diffJson`. An array when the input is a stream. */
  value: unknown;
  /** Explainable normalisation, in the order it happened (Rule 3). */
  notes: string[];
  /** Documents in the stream. More than one means `value` is an array. */
  documents: number;
}

export interface YamlProblem extends Error {
  line?: number;
  column?: number;
}

export class YamlParseError extends Error implements YamlProblem {
  readonly line: number | undefined;
  readonly column: number | undefined;

  constructor(message: string, position?: { line: number; column: number }) {
    super(message);
    this.name = 'YamlParseError';
    this.line = position?.line;
    this.column = position?.column;
  }
}

/**
 * Anchors, aliases and merge keys, counted before they are resolved.
 *
 * They matter to the *explanation*, not to the comparison: `yaml` expands an
 * alias into the value it points at, so a file using `&defaults`/`*defaults` and
 * a file with the block written out twice compare as identical. That is correct —
 * they describe the same data — but surprising enough that the result has to say
 * it happened (Rule 3), or the user concludes the diff is broken.
 */
function countReferences(document: Document.Parsed): {
  anchors: number;
  aliases: number;
  merges: number;
} {
  let anchors = 0;
  let aliases = 0;
  let merges = 0;

  visit(document, {
    Node(_key, node) {
      // `anchor` lives on the node, not on the pair, so this catches an anchor
      // wherever it was declared.
      const anchored = node as { anchor?: string };
      if (typeof anchored.anchor === 'string' && anchored.anchor !== '') anchors += 1;
      if (isAlias(node)) aliases += 1;
    },
    Pair(_key, pair) {
      if (isMergeKey(pair.key)) merges += 1;
    },
  });

  return { anchors, aliases, merges };
}

/**
 * `<<: *base` — YAML 1.1's inheritance, still ubiquitous in Docker Compose and CI
 * configuration.
 *
 * Identified by `source`, not by `value`: under `merge: true` the `yaml` package
 * replaces the key's *value* with `undefined` and attaches an `addToJSMap` hook,
 * so checking `value === '<<'` never matches. It also means a merge key looks like
 * a non-string key to any naive check — which is why `hasComplexKeys` has to skip
 * it or every Compose file gets a "non-string mapping keys" note it has not earned.
 */
function isMergeKey(key: unknown): boolean {
  if (!isScalar(key)) return false;
  const scalar = key as { value?: unknown; source?: unknown };
  return scalar.value === '<<' || scalar.source === '<<';
}

/** True when the document maps something that is not a plain string key. */
function hasComplexKeys(document: Document.Parsed): boolean {
  let found = false;
  visit(document, {
    Pair(_key, pair) {
      if (isMergeKey(pair.key)) return;
      if (!isScalar(pair.key)) found = true;
      else if (typeof pair.key.value !== 'string' && pair.key.value !== null) found = true;
    },
  });
  return found;
}

/**
 * Makes a parsed YAML value comparable by the JSON core.
 *
 * YAML's type system is wider than JSON's, and three of the extras break the core
 * outright rather than merely reading oddly:
 *
 *  - **`Date`** — the core's array-identity matching keys on `JSON.stringify`,
 *    which turns every date into the same ISO string only by luck of
 *    `toJSON`; but its `typeOf` reports `object`, so two dates would compare as
 *    empty objects and always look equal.
 *  - **`Map`/`Set`** (from complex keys, `!!set`) — `JSON.stringify` renders both
 *    as `{}`, so every one compares equal to every other.
 *  - **`Infinity`/`NaN`** — legal YAML (`.inf`, `.nan`), and `JSON.stringify`
 *    turns them into `null`, silently equating `.inf` with `~`.
 *
 * Each becomes a string that prints as what it is. A string is a lie about the
 * type, but a visible one; the alternatives are wrong answers.
 */
export function toComparable(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || value === undefined) return value;

  if (typeof value === 'number') {
    if (Number.isNaN(value)) return '.nan';
    if (value === Number.POSITIVE_INFINITY) return '.inf';
    if (value === Number.NEGATIVE_INFINITY) return '-.inf';
    return value;
  }

  if (typeof value === 'bigint') return value.toString();
  if (typeof value !== 'object') return value;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? 'invalid date' : value.toISOString();
  }
  if (value instanceof Uint8Array) return `!!binary (${value.byteLength} bytes)`;

  // An alias can legitimately produce the same object twice; a *cycle* cannot be
  // compared and must not hang the walk.
  if (seen.has(value)) return '[circular]';
  seen.add(value);

  try {
    if (value instanceof Map) {
      return Object.fromEntries(
        [...value.entries()].map(([key, item]) => [
          typeof key === 'string' ? key : JSON.stringify(toComparable(key, seen)),
          toComparable(item, seen),
        ]),
      );
    }
    if (value instanceof Set) {
      return [...value.values()].map((item) => toComparable(item, seen));
    }
    if (Array.isArray(value)) return value.map((item) => toComparable(item, seen));

    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        toComparable(item, seen),
      ]),
    );
  } finally {
    // Removed on the way out so a repeated *sibling* is not mistaken for a cycle.
    seen.delete(value);
  }
}

/**
 * Parses a YAML stream into one comparable value.
 *
 * `parseAllDocuments` rather than `parse`: a `---`-separated stream is ordinary
 * YAML — Kubernetes manifests are usually written that way — and quietly
 * comparing only the first document would be a wrong answer that looks right.
 */
export function parseYaml(text: string, label: string): YamlParse {
  // `merge: true` is a *parse* option, not a `toJS` one, and without it `<<: *base`
  // survives into the value as a literal key called `<<` holding the merged map.
  // Every Docker Compose and GitLab CI file in existence uses merge keys, so a
  // comparison that kept them would put "<<" rows in the tree and report the
  // inherited fields as missing.
  const documents = parseAllDocuments(text, { merge: true });
  const notes: string[] = [];

  const failed = documents.find((document) => document.errors.length > 0);
  const problem = failed?.errors[0];
  if (problem !== undefined) {
    // The package reports `{ line, col }`; everything downstream says `column`.
    const at = problem.linePos?.[0];
    throw new YamlParseError(
      `${label} is not valid YAML — ${problem.message}`,
      at === undefined ? undefined : { line: at.line, column: at.col },
    );
  }

  // An empty file parses to a single null document; treat it as such rather than
  // as a stream of one.
  const real = documents.filter((document) => document.contents !== null);
  const totals = { anchors: 0, aliases: 0, merges: 0 };
  let complexKeys = false;

  for (const document of documents) {
    const counts = countReferences(document);
    totals.anchors += counts.anchors;
    totals.aliases += counts.aliases;
    totals.merges += counts.merges;
    if (hasComplexKeys(document)) complexKeys = true;
  }

  if (totals.aliases > 0) {
    notes.push(
      `Expanded ${totals.aliases} alias${totals.aliases === 1 ? '' : 'es'} in ${label} — ` +
        `an anchor and the value written out in full compare as identical.`,
    );
  } else if (totals.anchors > 0) {
    notes.push(`${label} declares ${totals.anchors} anchor${totals.anchors === 1 ? '' : 's'}.`);
  }
  if (totals.merges > 0) {
    notes.push(
      `Applied ${totals.merges} merge key${totals.merges === 1 ? '' : 's'} (\`<<\`) in ${label}.`,
    );
  }
  if (complexKeys) {
    notes.push(`${label} has non-string mapping keys — they compare by their printed form.`);
  }

  const values = documents.map((document) => toComparable(document.toJS({ maxAliasCount: -1 })));

  if (real.length > 1) {
    notes.push(`${label} is a stream of ${real.length} documents, compared in order.`);
    return { value: values, notes, documents: real.length };
  }

  return { value: values[0] ?? null, notes, documents: real.length };
}

/** Is this mapping-shaped enough that `--engine yaml` is worth suggesting? */
export function looksLikeYaml(text: string): boolean {
  const lines = text.split('\n').slice(0, 40);
  const meaningful = lines.filter(
    (line) => line.trim() !== '' && !line.trimStart().startsWith('#'),
  );
  if (meaningful.length === 0) return false;
  const keyish = meaningful.filter((line) => /^\s*(-\s+)?[\w.'"-]+\s*:(\s|$)/.test(line));
  return keyish.length / meaningful.length > 0.6;
}

export { isMap };
