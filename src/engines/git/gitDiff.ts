import { assertSafeRef, refLabel, WORKTREE } from './refs';
import type { GitHost } from '../types';

/**
 * Git ref comparison (v0.2.1, MD §19).
 *
 * The work is a parse, not a diff: `git` already knows what changed between two
 * refs, and it is faster and more correct about renames than anything we would
 * write. So this module builds two argv arrays, reads the two outputs, and pairs
 * them up per path.
 *
 * `-z` throughout, and not as a nicety — a path may legally contain a newline,
 * and the line-oriented forms of these commands quote such paths in a format
 * that then has to be un-quoted. NUL-separated output has no such ambiguity.
 */

export type GitStatus = 'add' | 'del' | 'mod' | 'rename' | 'copy' | 'type' | 'unmerged' | 'unknown';

export interface GitFileRow {
  /** Path on the AFTER side. For a deletion, the path it had on the BEFORE side. */
  path: string;
  /** Set for renames and copies: where the content came from. */
  oldPath?: string;
  status: GitStatus;
  /** Lines added / removed. Both `0` for a binary file — see `binary`. */
  added: number;
  removed: number;
  /** git reported `-` for the counts, i.e. it treated the file as binary. */
  binary: boolean;
  /** Rename/copy similarity, 0–100, as git scored it. */
  score?: number;
}

export interface GitRefInfo {
  ref: string;
  /** `working tree` for the sentinel, otherwise the ref as typed. */
  label: string;
}

export interface GitDiffData {
  rows: GitFileRow[];
  repo: string;
  before: GitRefInfo;
  after: GitRefInfo;
  totals: { added: number; removed: number };
  /** True when the change set was capped at `MAX_FILES`. */
  partial: boolean;
}

export interface GitDiffOptions {
  detectRenames: boolean;
  /** Similarity percentage git needs before it calls something a rename. */
  renameThreshold: number;
  ignoreWhitespace: boolean;
}

export const DEFAULT_GIT_OPTIONS: GitDiffOptions = {
  detectRenames: true,
  renameThreshold: 50,
  ignoreWhitespace: false,
};

/** A change set larger than this is reported partially rather than slowly. */
export const MAX_FILES = 20_000;

export interface GitDiffStats {
  added: number;
  removed: number;
  modified: number;
  renamed: number;
  copied: number;
  binary: number;
}

/**
 * The argv for one `git diff`. Both callers share it so `--name-status` and
 * `--numstat` can never disagree about which two things are being compared.
 *
 * Ref order is BEFORE then AFTER, matching git's own `<from> <to>`. The working
 * tree is not a ref git accepts, so it is expressed by *omitting* an argument —
 * `git diff <ref>` compares that ref against the files on disk.
 */
export function diffArgs(
  format: '--name-status' | '--numstat',
  before: string,
  after: string,
  options: GitDiffOptions,
): string[] {
  assertSafeRef(before);
  assertSafeRef(after);

  const args = ['diff', format, '-z', '--no-color'];
  if (options.detectRenames) {
    const threshold = Math.max(10, Math.min(100, Math.round(options.renameThreshold)));
    args.push(`--find-renames=${threshold}%`);
  } else {
    args.push('--no-renames');
  }
  if (options.ignoreWhitespace) args.push('--ignore-all-space');

  // Exactly one side may be the working tree. When it is the BEFORE side the
  // comparison runs the other way round and every status is inverted afterwards.
  const named = [before, after].filter((ref) => ref !== WORKTREE);
  args.push(...named, '--');
  return args;
}

/** True when the pair has to be read backwards and re-labelled. */
export function isInverted(before: string, after: string): boolean {
  return before === WORKTREE && after !== WORKTREE;
}

const STATUS_LETTER: Record<string, GitStatus> = {
  A: 'add',
  D: 'del',
  M: 'mod',
  R: 'rename',
  C: 'copy',
  T: 'type',
  U: 'unmerged',
};

/** Splitting on NUL leaves one empty tail, because every record is terminated. */
function fields(output: string): string[] {
  const parts = output.split('\0');
  if (parts[parts.length - 1] === '') parts.pop();
  return parts;
}

interface NameStatusRecord {
  status: GitStatus;
  score?: number;
  path: string;
  oldPath?: string;
}

/**
 * `git diff --name-status -z` → records.
 *
 * A rename or copy is a **three**-field record (`R100`, old, new) where every
 * other status is two. Treating them all as pairs is the classic way to get this
 * wrong: the old path becomes a row and every subsequent record shifts by one.
 */
export function parseNameStatus(output: string): NameStatusRecord[] {
  const parts = fields(output);
  const records: NameStatusRecord[] = [];

  for (let index = 0; index < parts.length;) {
    const raw = parts[index] as string;
    index += 1;

    const letter = raw.slice(0, 1);
    const status = STATUS_LETTER[letter] ?? 'unknown';
    const digits = raw.slice(1);
    const score = digits === '' ? undefined : Number.parseInt(digits, 10);

    if (status === 'rename' || status === 'copy') {
      const oldPath = parts[index];
      const newPath = parts[index + 1];
      index += 2;
      if (oldPath === undefined || newPath === undefined) break;
      records.push({
        status,
        path: newPath,
        oldPath,
        ...(score !== undefined && Number.isFinite(score) ? { score } : {}),
      });
      continue;
    }

    const path = parts[index];
    index += 1;
    if (path === undefined) break;
    records.push({ status, path });
  }

  return records;
}

export interface NumStatRecord {
  path: string;
  added: number;
  removed: number;
  binary: boolean;
}

/**
 * `git diff --numstat -z` → per-path line counts.
 *
 * The rename form is the trap again, differently shaped: the path field is
 * *empty* and the two real paths follow as their own NUL-terminated fields
 * (`3\t1\t\0old\0new\0`). Keyed by the new path, which is what `--name-status`
 * also reports for a rename.
 */
export function parseNumStat(output: string): Map<string, NumStatRecord> {
  const parts = fields(output);
  const byPath = new Map<string, NumStatRecord>();

  for (let index = 0; index < parts.length;) {
    const record = parts[index] as string;
    index += 1;

    const firstTab = record.indexOf('\t');
    const secondTab = record.indexOf('\t', firstTab + 1);
    if (firstTab === -1 || secondTab === -1) continue;

    const addedText = record.slice(0, firstTab);
    const removedText = record.slice(firstTab + 1, secondTab);
    let path = record.slice(secondTab + 1);

    if (path === '') {
      // Rename/copy: the paths are the next two fields. Key on the new one.
      index += 1;
      const newPath = parts[index];
      index += 1;
      if (newPath === undefined) break;
      path = newPath;
    }

    const binary = addedText === '-' || removedText === '-';
    byPath.set(path, {
      path,
      binary,
      added: binary ? 0 : Number.parseInt(addedText, 10) || 0,
      removed: binary ? 0 : Number.parseInt(removedText, 10) || 0,
    });
  }

  return byPath;
}

/** A→D, D→A: reading the working tree as the BEFORE side reverses every verb. */
function invert(status: GitStatus): GitStatus {
  if (status === 'add') return 'del';
  if (status === 'del') return 'add';
  return status;
}

/**
 * Pairs the two outputs into rows, inverting when the working tree is the BEFORE
 * side. Sorted by path so the list is stable between runs — git's own order
 * follows its tree walk, which is stable but not alphabetical.
 */
export function buildRows(
  nameStatus: string,
  numStat: string,
  inverted: boolean,
): { rows: GitFileRow[]; partial: boolean } {
  const counts = parseNumStat(numStat);
  const records = parseNameStatus(nameStatus);
  const partial = records.length > MAX_FILES;
  const kept = partial ? records.slice(0, MAX_FILES) : records;

  const rows = kept.map((record): GitFileRow => {
    const count = counts.get(record.path);
    const added = count?.added ?? 0;
    const removed = count?.removed ?? 0;

    return {
      path: record.path,
      status: inverted ? invert(record.status) : record.status,
      // Inverting the pair swaps which side gained lines, too.
      added: inverted ? removed : added,
      removed: inverted ? added : removed,
      binary: count?.binary ?? false,
      ...(record.oldPath !== undefined ? { oldPath: record.oldPath } : {}),
      ...(record.score !== undefined ? { score: record.score } : {}),
    };
  });

  rows.sort((one, two) => one.path.localeCompare(two.path));
  return { rows, partial };
}

export function summarise(rows: readonly GitFileRow[]): GitDiffStats {
  const stats: GitDiffStats = {
    added: 0,
    removed: 0,
    modified: 0,
    renamed: 0,
    copied: 0,
    binary: 0,
  };

  for (const row of rows) {
    if (row.binary) stats.binary += 1;
    switch (row.status) {
      case 'add':
        stats.added += 1;
        break;
      case 'del':
        stats.removed += 1;
        break;
      case 'rename':
        stats.renamed += 1;
        stats.modified += 1;
        break;
      case 'copy':
        stats.copied += 1;
        stats.added += 1;
        break;
      default:
        // A type change or an unmerged path is a modification as far as the
        // summary strip is concerned: something is different at that path.
        stats.modified += 1;
    }
  }

  return stats;
}

export function notesFor(options: GitDiffOptions, stats: GitDiffStats, partial: boolean): string[] {
  const notes: string[] = [];

  notes.push(
    options.detectRenames
      ? `Renames detected by git at ${options.renameThreshold}% similarity.`
      : 'Rename detection off — a moved file reads as one addition and one removal.',
  );
  if (options.ignoreWhitespace) {
    notes.push('Whitespace-only changes were ignored, so some files may be absent entirely.');
  }
  if (stats.binary > 0) {
    notes.push(
      `${stats.binary} binary file${stats.binary === 1 ? '' : 's'} — git reports no line counts for these.`,
    );
  }
  if (partial) {
    notes.push(
      `Stopped after ${MAX_FILES.toLocaleString()} changed files — this is a partial comparison.`,
    );
  }

  return notes;
}

/**
 * Runs both commands and assembles the result. Two calls rather than one because
 * no single `git diff` format carries statuses *and* line counts.
 */
export async function diffRefs(
  git: GitHost,
  repo: string,
  before: string,
  after: string,
  options: GitDiffOptions,
  hooks: {
    onProgress?: (percent: number, message?: string) => void;
    shouldAbort?: () => boolean;
  } = {},
): Promise<{ data: GitDiffData; stats: GitDiffStats; notes: string[] }> {
  const inverted = isInverted(before, after);

  hooks.onProgress?.(15, `reading ${refLabel(before)} → ${refLabel(after)}`);
  const nameStatus = await git.run(repo, diffArgs('--name-status', before, after, options));

  if (hooks.shouldAbort?.() === true) throw new DOMException('Comparison cancelled', 'AbortError');

  hooks.onProgress?.(60, 'counting lines');
  const numStat = await git.run(repo, diffArgs('--numstat', before, after, options));

  if (hooks.shouldAbort?.() === true) throw new DOMException('Comparison cancelled', 'AbortError');

  const { rows, partial } = buildRows(nameStatus, numStat, inverted);
  const stats = summarise(rows);

  hooks.onProgress?.(100, 'done');

  return {
    data: {
      rows,
      repo,
      before: { ref: before, label: refLabel(before) },
      after: { ref: after, label: refLabel(after) },
      totals: {
        added: rows.reduce((sum, row) => sum + row.added, 0),
        removed: rows.reduce((sum, row) => sum + row.removed, 0),
      },
      partial,
    },
    stats,
    notes: notesFor(options, stats, partial),
  };
}
