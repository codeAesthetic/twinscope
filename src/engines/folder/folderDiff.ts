import { detectRenamesV2, renameNote, type RenameEntry } from './renames';
import type { HostFs } from '../types';

/**
 * Recursive folder comparison (MD §8.3/§15).
 *
 * Two passes: walk each side into a flat map of relative paths, then decide a
 * status per path. Keeping the walk and the comparison separate is what makes
 * "one side failed to read" a per-entry problem rather than an aborted scan.
 *
 * Cheap checks first — a size difference is a definite change and costs one
 * stat, so hashing only ever runs on the ambiguous case (same size, different
 * mtime).
 */

export type FolderStatus = 'same' | 'add' | 'del' | 'mod' | 'error';

export interface FolderSide {
  name: string;
  /** 'nil' means this side has no such entry — rendered as an empty stripe. */
  status: FolderStatus | 'nil';
  size?: number;
}

export interface FolderRow {
  depth: number;
  isDir: boolean;
  /** Relative to the compared root. `''` for the root itself. */
  path: string;
  /** Row-level status, what the filters and change navigation use. */
  status: FolderStatus;
  left: FolderSide;
  right: FolderSide;
  /** Rename pairing or the reason an entry could not be read. */
  note?: string;
}

export interface FolderDiffOptions {
  detectRenames: boolean;
  /** Hash files whose size matches but whose mtime does not. */
  compareContentHash: boolean;
  ignore: string[];
  /**
   * Minimum similarity score (0–100) before a removal and an addition are called
   * one rename (v0.2.11). Below it they stay two separate events.
   */
  renameThreshold?: number;
}

/**
 * The similarity floor for calling two files one rename (v0.2.11).
 *
 * 50 is deliberately permissive: a false pairing shows its score in the note and
 * costs a reader one glance, while a missed one costs them a deletion and an
 * addition that they have to spot are the same file.
 */
export const DEFAULT_RENAME_THRESHOLD = 50;

export const DEFAULT_FOLDER_OPTIONS: FolderDiffOptions = {
  detectRenames: true,
  compareContentHash: true,
  ignore: ['.git', 'node_modules', '.DS_Store'],
  renameThreshold: DEFAULT_RENAME_THRESHOLD,
};

export interface FolderDiffData {
  rows: FolderRow[];
  roots: { before: string; after: string };
  files: { before: number; after: number };
  /** True when a guard stopped the scan early. */
  partial: boolean;
}

export interface FolderDiffStats {
  added: number;
  removed: number;
  modified: number;
  identical: number;
  renames: number;
  errors: number;
  bytesDelta: number;
}

/** Past this the scan goes partial rather than making the user wait (MD §31). */
export const MAX_ENTRIES = 50_000;
/** A tree this deep is either generated or a symlink loop we failed to spot. */
export const MAX_DEPTH = 40;
/** Progress ticks at this granularity — often enough to feel live, rare enough to be free. */
const PROGRESS_EVERY = 500;

export interface WalkEntry {
  path: string;
  isDir: boolean;
  size: number;
  mtimeMs: number;
  /** Set when the entry could not be read; it still shows up as a row. */
  error?: string;
}

export interface WalkResult {
  entries: Map<string, WalkEntry>;
  files: number;
  symlinks: number;
  truncated: boolean;
  depthCapped: boolean;
}

function ignored(name: string, patterns: readonly string[]): boolean {
  return patterns.includes(name);
}

/**
 * Depth-first walk of one root. Never throws for a single unreadable entry —
 * a folder with one protected subdirectory still produces a useful comparison.
 */
export async function walkTree(
  fs: HostFs,
  root: string,
  options: FolderDiffOptions,
  hooks: { onProgress?: (count: number) => void; shouldAbort?: () => boolean } = {},
): Promise<WalkResult> {
  const entries = new Map<string, WalkEntry>();
  let files = 0;
  let symlinks = 0;
  let truncated = false;
  let depthCapped = false;

  const visit = async (absolute: string, relative: string, depth: number): Promise<void> => {
    if (truncated) return;
    if (hooks.shouldAbort?.() === true)
      throw new DOMException('Comparison cancelled', 'AbortError');

    if (depth > MAX_DEPTH) {
      depthCapped = true;
      return;
    }

    let listing;
    try {
      listing = await fs.listDir(absolute);
    } catch (cause) {
      entries.set(relative, {
        path: relative,
        isDir: true,
        size: 0,
        mtimeMs: 0,
        error: cause instanceof Error ? cause.message : String(cause),
      });
      return;
    }

    for (const entry of listing) {
      if (truncated) return;
      if (ignored(entry.name, options.ignore)) continue;

      // Symlinks are counted and skipped: following them risks a cycle, and
      // comparing the link target is a different question than comparing files.
      if (entry.isSymlink) {
        symlinks += 1;
        continue;
      }

      const childRelative = relative === '' ? entry.name : `${relative}/${entry.name}`;

      if (entries.size >= MAX_ENTRIES) {
        truncated = true;
        return;
      }

      if (entry.isDirectory) {
        entries.set(childRelative, { path: childRelative, isDir: true, size: 0, mtimeMs: 0 });
        await visit(entry.path, childRelative, depth + 1);
        continue;
      }

      try {
        const info = await fs.stat(entry.path);
        entries.set(childRelative, {
          path: childRelative,
          isDir: false,
          size: info.size,
          mtimeMs: info.mtimeMs,
        });
      } catch (cause) {
        entries.set(childRelative, {
          path: childRelative,
          isDir: false,
          size: 0,
          mtimeMs: 0,
          error: cause instanceof Error ? cause.message : String(cause),
        });
      }

      files += 1;
      if (files % PROGRESS_EVERY === 0) hooks.onProgress?.(files);
    }
  };

  await visit(root, '', 0);
  return { entries, files, symlinks, truncated, depthCapped };
}

function baseName(path: string): string {
  const cut = path.lastIndexOf('/');
  return cut === -1 ? path : path.slice(cut + 1);
}

/**
 * Orders rows the way a file tree reads: directories before files, alphabetical
 * within a level, children directly under their parent.
 */
function treeOrder(paths: Iterable<string>, isDir: (path: string) => boolean): string[] {
  return [...paths].sort((one, two) => {
    const a = one.split('/');
    const b = two.split('/');
    const shared = Math.min(a.length, b.length);

    for (let level = 0; level < shared; level += 1) {
      if (a[level] === b[level]) continue;

      // At the level where they diverge, directories sort first.
      const aIsDir = level < a.length - 1 || isDir(one);
      const bIsDir = level < b.length - 1 || isDir(two);
      if (aIsDir !== bIsDir) return aIsDir ? -1 : 1;

      return (a[level] as string).localeCompare(b[level] as string);
    }

    return a.length - b.length;
  });
}

export async function diffFolders(
  fs: HostFs,
  rootA: string,
  rootB: string,
  options: FolderDiffOptions,
  hooks: {
    onProgress?: (percent: number, message?: string) => void;
    shouldAbort?: () => boolean;
  } = {},
): Promise<{ data: FolderDiffData; stats: FolderDiffStats; notes: string[] }> {
  const walkHooks = {
    ...(hooks.shouldAbort !== undefined ? { shouldAbort: hooks.shouldAbort } : {}),
  };

  hooks.onProgress?.(10, `scanning ${rootA}`);
  const before = await walkTree(fs, rootA, options, {
    ...walkHooks,
    onProgress: (count) => hooks.onProgress?.(10, `scanned ${count} files`),
  });

  hooks.onProgress?.(40, `scanning ${rootB}`);
  const after = await walkTree(fs, rootB, options, {
    ...walkHooks,
    onProgress: (count) => hooks.onProgress?.(40, `scanned ${count} files`),
  });

  hooks.onProgress?.(70, 'comparing');

  const stats: FolderDiffStats = {
    added: 0,
    removed: 0,
    modified: 0,
    identical: 0,
    renames: 0,
    errors: 0,
    bytesDelta: 0,
  };

  const allPaths = new Set([...before.entries.keys(), ...after.entries.keys()]);
  const isDir = (path: string): boolean =>
    (before.entries.get(path)?.isDir ?? after.entries.get(path)?.isDir) === true;

  const statuses = new Map<string, FolderStatus>();
  const notesByPath = new Map<string, string>();
  let hashed = 0;

  for (const path of allPaths) {
    if (hooks.shouldAbort?.() === true)
      throw new DOMException('Comparison cancelled', 'AbortError');

    const left = before.entries.get(path);
    const right = after.entries.get(path);

    if (left?.error !== undefined || right?.error !== undefined) {
      statuses.set(path, 'error');
      notesByPath.set(path, left?.error ?? right?.error ?? 'could not be read');
      stats.errors += 1;
      continue;
    }

    if (left === undefined) {
      statuses.set(path, 'add');
      if (right?.isDir !== true) {
        stats.added += 1;
        stats.bytesDelta += right?.size ?? 0;
      }
      continue;
    }
    if (right === undefined) {
      statuses.set(path, 'del');
      if (!left.isDir) {
        stats.removed += 1;
        stats.bytesDelta -= left.size;
      }
      continue;
    }

    if (left.isDir || right.isDir) {
      statuses.set(path, 'same');
      continue;
    }

    if (left.size !== right.size) {
      statuses.set(path, 'mod');
      stats.modified += 1;
      stats.bytesDelta += right.size - left.size;
      continue;
    }

    if (left.mtimeMs === right.mtimeMs) {
      statuses.set(path, 'same');
      stats.identical += 1;
      continue;
    }

    // Same size, different mtime: the only case where the answer needs content.
    if (!options.compareContentHash) {
      statuses.set(path, 'same');
      stats.identical += 1;
      continue;
    }

    try {
      const [hashA, hashB] = await Promise.all([
        fs.hashFile(`${rootA}/${path}`),
        fs.hashFile(`${rootB}/${path}`),
      ]);
      hashed += 1;
      if (hashA === hashB) {
        statuses.set(path, 'same');
        stats.identical += 1;
      } else {
        statuses.set(path, 'mod');
        stats.modified += 1;
      }
    } catch (cause) {
      statuses.set(path, 'error');
      notesByPath.set(path, cause instanceof Error ? cause.message : String(cause));
      stats.errors += 1;
    }
  }

  const renameNotes: string[] = [];
  if (options.detectRenames) {
    // v0.2.11: scoring lives in `renames.ts`, and it needs the filesystem to read
    // content — so this is `await`ed where v1's name-and-size rule was synchronous.
    const removals: RenameEntry[] = [];
    const additions: RenameEntry[] = [];
    for (const [path, status] of statuses) {
      if (status === 'del' && before.entries.get(path)?.isDir === false) {
        removals.push({ path, size: before.entries.get(path)?.size ?? 0 });
      } else if (status === 'add' && after.entries.get(path)?.isDir === false) {
        additions.push({ path, size: after.entries.get(path)?.size ?? 0 });
      }
    }

    const detected = await detectRenamesV2(
      fs,
      { before: rootA, after: rootB },
      removals,
      additions,
      { threshold: options.renameThreshold ?? DEFAULT_RENAME_THRESHOLD },
    );

    for (const pair of detected.pairs) {
      stats.renames += 1;
      notesByPath.set(pair.added, renameNote('from', pair.removed, pair.score));
      notesByPath.set(pair.removed, renameNote('to', pair.added, pair.score));
    }
    renameNotes.push(...detected.notes);
  }

  // Directories inherit their subtree: a folder is "modified" when anything
  // inside it is, which is what makes the collapsed tree readable.
  const ordered = treeOrder(allPaths, isDir);
  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    const path = ordered[index] as string;
    if (!isDir(path)) continue;
    if (statuses.get(path) !== 'same') continue;

    const prefix = `${path}/`;
    const changed = ordered.some(
      (other) => other.startsWith(prefix) && (statuses.get(other) ?? 'same') !== 'same',
    );
    if (changed) statuses.set(path, 'mod');
  }

  const rows: FolderRow[] = ordered.map((path) => {
    const left = before.entries.get(path);
    const right = after.entries.get(path);
    const status = statuses.get(path) ?? 'same';
    const name = baseName(path) + (isDir(path) ? '/' : '');
    const note = notesByPath.get(path);

    return {
      depth: path.split('/').length - 1,
      isDir: isDir(path),
      path,
      status,
      left:
        left === undefined
          ? { name: '', status: 'nil' }
          : { name, status, ...(left.isDir ? {} : { size: left.size }) },
      right:
        right === undefined
          ? { name: '', status: 'nil' }
          : { name, status, ...(right.isDir ? {} : { size: right.size }) },
      ...(note !== undefined ? { note } : {}),
    };
  });

  const notes: string[] = [];
  if (options.ignore.length > 0) notes.push(`Skipped ${options.ignore.join(', ')}.`);
  const symlinks = before.symlinks + after.symlinks;
  if (symlinks > 0) {
    notes.push(`Skipped ${symlinks} symlink${symlinks === 1 ? '' : 's'} — links are not followed.`);
  }
  if (options.compareContentHash && hashed > 0) {
    notes.push(
      `Hashed ${hashed} file${hashed === 1 ? '' : 's'} whose size matched but timestamp did not.`,
    );
  } else if (!options.compareContentHash) {
    notes.push('Compared by size and timestamp only — content was not hashed.');
  }
  if (stats.renames > 0) {
    notes.push(
      `Paired ${stats.renames} rename${stats.renames === 1 ? '' : 's'} by content and name, including moves between folders.`,
    );
  }
  notes.push(...renameNotes);
  if (before.depthCapped || after.depthCapped)
    notes.push(`Stopped descending below ${MAX_DEPTH} levels.`);
  const partial = before.truncated || after.truncated;
  if (partial) {
    notes.push(
      `Stopped after ${MAX_ENTRIES.toLocaleString()} entries per side — this is a partial comparison.`,
    );
  }

  hooks.onProgress?.(100, 'done');

  return {
    data: {
      rows,
      roots: { before: rootA, after: rootB },
      files: { before: before.files, after: after.files },
      partial,
    },
    stats,
    notes,
  };
}
