import { parseYaml, YamlParseError } from './yamlDiff';
import { diffJson, DEFAULT_JSON_OPTIONS } from '../json/jsonDiff';
import { EngineInputError, type DiffEngine, type DiffResult, type InputRef } from '../types';
import type { JsonDiffData, JsonDiffOptions } from '../json/jsonDiff';

export type { YamlParse } from './yamlDiff';
export { parseYaml, toComparable, looksLikeYaml, YamlParseError } from './yamlDiff';

/**
 * Options are the JSON engine's, unchanged and deliberately so: they describe how
 * two *parsed structures* are compared, and a YAML mapping is a JSON object by
 * the time either engine sees it. A separate `YamlDiffOptions` would be the same
 * four fields with a different name, and the normalisation rail in the shared view
 * would then have to know which it was looking at.
 */
export type YamlDiffOptions = JsonDiffOptions;
export type YamlDiffData = JsonDiffData;

async function textFor(input: InputRef, read: (path: string) => Promise<string>): Promise<string> {
  if (input.text !== undefined) return input.text;
  if (input.path !== undefined) return read(input.path);
  throw new Error(`${input.name} has no readable content.`);
}

function parse(text: string, label: string): { value: unknown; notes: string[] } {
  try {
    const parsed = parseYaml(text, label);
    return { value: parsed.value, notes: parsed.notes };
  } catch (cause) {
    if (cause instanceof YamlParseError) {
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
 * Structural YAML comparison (v0.2.3).
 *
 * The engine is a parser and a pair of notes; the comparison is `diffJson`. That
 * is not laziness — YAML's whole difficulty is in reading it (anchors, streams,
 * a wider scalar set), and once read there is nothing left that is YAML-specific.
 * Sharing the core also means the tree view, the reports and the five view modes
 * work here on the day this engine ships.
 *
 * It also claims a **YAML against a JSON**: YAML is a superset of JSON, so
 * `parseAllDocuments` reads both, and comparing a config against its JSON
 * equivalent is a real thing to want. Without this the pair fell through to a
 * line diff, which is the comparison a structural engine exists to avoid.
 */
export const yamlEngine: DiffEngine<YamlDiffOptions, YamlDiffData> = {
  meta: { id: 'yaml', label: 'Structural YAML diff', priority: 25 },

  canHandle: (a, b) => {
    const structural = (kind: string): boolean => kind === 'yaml' || kind === 'json';
    return structural(a.kind) && structural(b.kind) && (a.kind === 'yaml' || b.kind === 'yaml');
  },

  defaultOptions: () => ({ ...DEFAULT_JSON_OPTIONS, ignorePaths: [] }),

  async compare(a, b, options, ctx): Promise<DiffResult<YamlDiffData>> {
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
    if (a.kind !== b.kind) extra.formats = `${a.kind} ↔ ${b.kind}`;

    return {
      engineId: 'yaml',
      summary: {
        added: stats.added,
        removed: stats.removed,
        modified: stats.changed + stats.typeChanged,
        extra,
        suppressed: stats.suppressed,
      },
      data,
      // Parse notes first: they explain what the compared values *are*, which has
      // to be read before what the comparison did with them.
      normalizationNotes: [...before.notes, ...after.notes, ...notes],
      timings: { ms: Date.now() - startedAt },
    };
  },
};
