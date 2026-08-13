import {
  diffJson,
  DEFAULT_JSON_OPTIONS,
  type JsonDiffData,
  type JsonDiffOptions,
} from './jsonDiff';
import { radarFrom, ratioScore } from '../radar';
import { EngineInputError, type DiffEngine, type DiffResult, type InputRef } from '../types';

export type { JsonDiffData, JsonDiffOptions, JsonRow, JsonRowState } from './jsonDiff';
export { DEFAULT_JSON_OPTIONS, MAX_DEPTH, MAX_NODES, LARGE_ARRAY } from './jsonDiff';

/** Turns a byte offset into something a human can find in their editor. */
function locate(text: string, message: string): string {
  const already = /line (\d+) column (\d+)/.exec(message);
  if (already !== null) return ` at line ${already[1]}, column ${already[2]}`;

  const position = /position (\d+)/.exec(message);
  if (position === null) return '';

  const upto = text.slice(0, Number(position[1]));
  const line = upto.split('\n').length;
  const column = upto.length - upto.lastIndexOf('\n');
  return ` at line ${line}, column ${column}`;
}

/**
 * A parse failure is a dead end for this engine but not for the comparison:
 * the error carries `text` as a fallback so the UI can offer to compare the two
 * files as plain text instead.
 */
function parse(text: string, label: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (cause) {
    const raw = cause instanceof Error ? cause.message : String(cause);
    const detail = raw.replace(/^(Unexpected|Expected)/, (match) => match.toLowerCase());
    throw new EngineInputError(`${label} is not valid JSON — ${detail}${locate(text, raw)}.`, {
      fallbackEngineId: 'text',
      fallbackLabel: 'Compare as text',
    });
  }
}

async function textFor(input: InputRef, read: (path: string) => Promise<string>): Promise<string> {
  if (input.text !== undefined) return input.text;
  if (input.path !== undefined) return read(input.path);
  throw new Error(`${input.name} has no readable content.`);
}

/**
 * Structural JSON comparison (MD §8.2/§13).
 *
 * The point of a separate engine: reformatting a JSON file changes every line
 * and nothing meaningful. This compares the parsed values, so the answer is
 * about the data.
 */
export const jsonEngine: DiffEngine<JsonDiffOptions, JsonDiffData> = {
  meta: { id: 'json', label: 'Structural JSON diff', priority: 20 },

  canHandle: (a, b) => a.kind === 'json' && b.kind === 'json',

  defaultOptions: () => ({ ...DEFAULT_JSON_OPTIONS, ignorePaths: [] }),

  async compare(a, b, options, ctx): Promise<DiffResult<JsonDiffData>> {
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
    const { data, stats, notes } = diffJson(before, after, options, () => ctx.signal.aborted);

    ctx.progress(100, 'done');

    const extra: Record<string, number | string> = { nodes: data.nodes };
    if (stats.typeChanged > 0) {
      extra[`type change${stats.typeChanged === 1 ? '' : 's'}`] = `⚠ ${stats.typeChanged}`;
    }

    return {
      engineId: 'json',
      summary: {
        added: stats.added,
        removed: stats.removed,
        // Type changes are modifications with a warning attached; counting them
        // separately would make the strip's total disagree with the tree.
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
      normalizationNotes: notes,
      timings: { ms: Date.now() - startedAt },
    };
  },
};
