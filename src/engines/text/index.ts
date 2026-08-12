import { diffText, type TextDiffData, type TextDiffOptions } from './textDiff';
import type { DiffEngine, DiffResult, InputRef } from '../types';

export type { TextDiffData, TextDiffOptions, TextRow, TextRowKind } from './textDiff';
export { MARK_OPEN, MARK_CLOSE } from './textDiff';

/** Anything textual can be line-diffed, so this is the universal fallback. */
const COMPARABLE = new Set(['text', 'code', 'json', 'yaml', 'csv', 'md']);

async function textFor(input: InputRef, read: (path: string) => Promise<string>): Promise<string> {
  if (input.text !== undefined) return input.text;
  if (input.path !== undefined) return read(input.path);
  throw new Error(`${input.name} has no readable content.`);
}

/**
 * Text / code comparison (MD §8.1) — the engine every other one falls back to.
 *
 * Line-based rather than syntax-aware for now; AST-level moves and renames are
 * V1 work (MD §27). What it does give you is readable output: edited lines pair
 * up with word-level marks instead of appearing as unrelated delete/add noise.
 */
export const textEngine: DiffEngine<TextDiffOptions, TextDiffData> = {
  meta: { id: 'text', label: 'Text diff', priority: 0 },

  canHandle: (a, b) => COMPARABLE.has(a.kind) && COMPARABLE.has(b.kind),

  defaultOptions: () => ({
    ignoreWhitespace: true,
    ignoreCase: false,
    collapseUnchanged: true,
  }),

  async compare(a, b, options, ctx): Promise<DiffResult<TextDiffData>> {
    const startedAt = Date.now();
    const read = async (path: string): Promise<string> => {
      if (ctx.fs === undefined) throw new Error('No filesystem access was provided.');
      return ctx.fs.readText(path);
    };

    ctx.progress(10, 'reading');
    const [before, after] = await Promise.all([textFor(a, read), textFor(b, read)]);

    if (ctx.signal.aborted) throw new DOMException('Comparison cancelled', 'AbortError');

    ctx.progress(45, 'comparing lines');
    const { data, stats, notes } = diffText(before, after, options);

    ctx.progress(100, 'done');

    return {
      engineId: 'text',
      summary: {
        added: stats.added,
        removed: stats.removed,
        modified: stats.modified,
        extra: { lines: Math.max(data.lines.before, data.lines.after) },
      },
      data,
      normalizationNotes: notes,
      timings: { ms: Date.now() - startedAt },
    };
  },
};
