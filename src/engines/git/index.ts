import { DEFAULT_GIT_OPTIONS, diffRefs, type GitDiffData, type GitDiffOptions } from './gitDiff';
import { assertSafeRef, WORKTREE } from './refs';
import { radarFrom, ratioScore } from '../radar';
import type { DiffEngine, DiffResult } from '../types';

export type { GitDiffData, GitDiffOptions, GitFileRow, GitRefInfo, GitStatus } from './gitDiff';
export { DEFAULT_GIT_OPTIONS, MAX_FILES } from './gitDiff';
export { WORKTREE, isSafeRef, assertSafeRef, refLabel } from './refs';

/**
 * Comparison of two refs in one git repository (v0.2.1, MD §19).
 *
 * Both sides must be the same repository: comparing a ref in one checkout against
 * a ref in another is a folder diff wearing a hat, and git cannot answer it in
 * one command anyway.
 */
export const gitEngine: DiffEngine<GitDiffOptions, GitDiffData> = {
  meta: { id: 'git', label: 'Git ref diff', priority: 45 },

  canHandle: (a, b) => a.kind === 'git' && b.kind === 'git',

  defaultOptions: () => ({ ...DEFAULT_GIT_OPTIONS }),

  async compare(a, b, options, ctx): Promise<DiffResult<GitDiffData>> {
    const startedAt = Date.now();

    if (ctx.git === undefined) throw new Error('No git access was provided.');
    if (a.path === undefined || b.path === undefined) {
      throw new Error('A git comparison needs a repository on disk.');
    }
    if (a.path !== b.path) {
      throw new Error('Both refs must come from the same repository.');
    }
    if (a.ref === undefined || b.ref === undefined) {
      throw new Error('A git comparison needs a ref on each side.');
    }
    if (a.ref === WORKTREE && b.ref === WORKTREE) {
      throw new Error('The working tree cannot be compared against itself.');
    }

    // Validated again here even though main already did it: the guard belongs to
    // the engine, so the CLI (v0.2.2) inherits it rather than re-implementing it.
    assertSafeRef(a.ref);
    assertSafeRef(b.ref);

    const repo = a.path;
    const fs = ctx.fs;

    const { data, stats, notes } = await diffRefs(ctx.git, repo, a.ref, b.ref, options, {
      onProgress: (percent, message) => ctx.progress(percent, message),
      shouldAbort: () => ctx.signal.aborted,
      // Untracked files are read through `HostFs`, not through git — git has no
      // record of them. Absent `fs` the rows still appear, with no line counts,
      // because knowing a file is new matters more than knowing how long it is.
      ...(fs !== undefined
        ? {
            countLines: async (path: string) => {
              const text = await fs.readText(`${repo}/${path}`);
              if (text === '') return 0;
              return text.endsWith('\n') ? text.split('\n').length - 1 : text.split('\n').length;
            },
          }
        : {}),
    });

    const extra: Record<string, number | string> = {
      lines: `＋${data.totals.added} －${data.totals.removed}`,
    };
    if (stats.renamed > 0) extra.renamed = stats.renamed;
    if (stats.copied > 0) extra.copied = stats.copied;
    if (stats.binary > 0) extra.binary = stats.binary;
    if (data.partial) extra.scan = 'partial';

    return {
      engineId: 'git',
      summary: {
        added: stats.added,
        removed: stats.removed,
        modified: stats.modified,
        extra,
        // Radar (v0.2.7). Scored on *files*, not lines: git reports how many lines
        // changed but never how many a file has, so there is no denominator for a
        // line ratio — and inventing one is exactly what "ship only when the scores
        // are honest" rules out. A rename is Metadata, as in the folder engine.
        radar: radarFrom({
          structure: ratioScore(stats.added + stats.removed, Math.max(1, data.rows.length)),
          content: ratioScore(stats.modified, Math.max(1, data.rows.length)),
          metadata: ratioScore(stats.renamed + stats.copied, Math.max(1, data.rows.length)),
        }),
      },
      data,
      normalizationNotes: notes,
      timings: { ms: Date.now() - startedAt },
    };
  },
};
