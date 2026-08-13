import {
  DEFAULT_FOLDER_OPTIONS,
  diffFolders,
  type FolderDiffData,
  type FolderDiffOptions,
} from './folderDiff';
import { deltaScore, radarFrom, ratioScore } from '../radar';
import type { DiffEngine, DiffResult } from '../types';

export type {
  FolderDiffData,
  FolderDiffOptions,
  FolderRow,
  FolderSide,
  FolderStatus,
} from './folderDiff';
export { DEFAULT_FOLDER_OPTIONS, MAX_ENTRIES, MAX_DEPTH } from './folderDiff';

/**
 * Recursive folder comparison (MD §8.3).
 *
 * The engine reads only metadata by default and reaches for content hashing
 * exactly once per ambiguous file, which is what keeps a 10k-file tree fast.
 */
export const folderEngine: DiffEngine<FolderDiffOptions, FolderDiffData> = {
  meta: { id: 'folder', label: 'File tree diff', priority: 40 },

  canHandle: (a, b) => a.kind === 'folder' && b.kind === 'folder',

  defaultOptions: () => ({ ...DEFAULT_FOLDER_OPTIONS, ignore: [...DEFAULT_FOLDER_OPTIONS.ignore] }),

  async compare(a, b, options, ctx): Promise<DiffResult<FolderDiffData>> {
    const startedAt = Date.now();

    if (ctx.fs === undefined) throw new Error('No filesystem access was provided.');
    if (a.path === undefined || b.path === undefined) {
      throw new Error('Folder comparison needs two folders on disk.');
    }

    const { data, stats, notes } = await diffFolders(ctx.fs, a.path, b.path, options, {
      onProgress: (percent, message) => ctx.progress(percent, message),
      shouldAbort: () => ctx.signal.aborted,
    });

    const extra: Record<string, number | string> = {
      identical: stats.identical,
    };
    // Radar denominators: the widest side's file count, and the bytes the BEFORE
    // side held. `bytesDelta` is signed, so the AFTER total is a sum, not a guess.
    const files = Math.max(data.files.before, data.files.after);
    const beforeBytes = data.rows.reduce((sum, row) => sum + (row.left.size ?? 0), 0);
    if (stats.renames > 0) extra.renamed = stats.renames;
    if (stats.errors > 0) extra.unreadable = stats.errors;
    if (stats.bytesDelta !== 0) extra['size'] = formatDelta(stats.bytesDelta);
    if (data.partial) extra.scan = 'partial';

    return {
      engineId: 'folder',
      summary: {
        added: stats.added,
        removed: stats.removed,
        modified: stats.modified,
        extra,
        // Radar (v0.2.7). A rename is a fact about a file rather than its content,
        // so it feeds Metadata; the byte delta is the one weight signal a tree walk
        // genuinely has.
        radar: radarFrom({
          structure: ratioScore(stats.added + stats.removed, Math.max(1, files)),
          content: ratioScore(stats.modified, Math.max(1, files)),
          metadata: ratioScore(stats.renames, Math.max(1, files)),
          performance: deltaScore(beforeBytes, beforeBytes + stats.bytesDelta),
        }),
      },
      data,
      normalizationNotes: notes,
      timings: { ms: Date.now() - startedAt },
    };
  },
};

function formatDelta(bytes: number): string {
  const sign = bytes > 0 ? '＋' : '－';
  const size = Math.abs(bytes);
  if (size < 1024) return `${sign}${size} B`;
  if (size < 1024 * 1024) return `${sign}${(size / 1024).toFixed(1)} KB`;
  return `${sign}${(size / (1024 * 1024)).toFixed(1)} MB`;
}
