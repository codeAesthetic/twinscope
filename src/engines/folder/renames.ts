import type { HostFs } from '../types';

/**
 * Rename and move detection (v0.2.11, MD §15, A4).
 *
 * v1 paired an unmatched removal with an unmatched addition when the sizes matched
 * *and* they sat in the same folder. That misses the two commonest cases outright:
 * a file that moved one directory up, and a file that was edited on the way.
 *
 * Three signals, in falling order of certainty:
 *
 *  1. **Identical content.** A hash match is not a guess.
 *  2. **The same basename elsewhere.** `src/a.ts` → `src/lib/a.ts` is a move even if
 *     the content also changed.
 *  3. **Similar content.** Chunk hashes over a sample, plus size proximity, for the
 *     file that was renamed *and* edited.
 *
 * Scoring lives here, away from the walk, because the scoring is the interesting
 * part and it should be testable without a filesystem.
 */

export interface RenameEntry {
  /** Path relative to the compared root. */
  path: string;
  size: number;
}

export interface RenamePair {
  removed: string;
  added: string;
  /** 0–100. 100 means the content is byte-identical. */
  score: number;
  /** Why it scored what it did, for the note. */
  reason: 'identical' | 'moved' | 'similar';
}

export interface RenameOptions {
  /** Below this score a pair is two separate events, not a rename. */
  threshold: number;
}

/**
 * Files larger than this are judged on their whole-file hash and size alone.
 *
 * Chunk sampling needs ranged reads, which `HostFs` deliberately does not offer —
 * adding one would change an interface that four different hosts implement, for a
 * heuristic. Reading a whole file to sample it is fine up to a point, and this is
 * the point.
 */
export const MAX_SAMPLED_BYTES = 2 * 1024 * 1024;

/**
 * Past this many candidate pairs, scoring is abandoned for v1's cheap rule.
 *
 * The comparison is |removals| × |additions|, so a scan where a thousand files
 * vanished and a thousand appeared is a million comparisons — each of which may read
 * a file. A 10k-file tree must not become quadratic silently.
 */
export const MAX_PAIRS = 4_000;

/** Bytes per sampled chunk, and how many chunks a file is cut into. */
const CHUNK_COUNT = 8;

/**
 * Below this, content similarity is not trusted at all.
 *
 * Eight chunks over a 27-byte file is three bytes per chunk, and at that size two
 * unrelated one-line modules — `export const gone = true;` and
 * `export const added = true;` — share most of their chunks and score as a rename.
 * A tiny file has to be judged on its *name*, which is the only reliable signal it
 * has. Found by the folder regression spec reporting three renames where two were
 * real.
 */
export const MIN_CONTENT_BYTES = 64;

function baseName(path: string): string {
  const cut = path.lastIndexOf('/');
  return cut === -1 ? path : path.slice(cut + 1);
}

function parentOf(path: string): string {
  const cut = path.lastIndexOf('/');
  return cut === -1 ? '' : path.slice(0, cut);
}

/**
 * How close two sizes are, 0–1. Used as a prior: two files of wildly different
 * length are rarely the same file, whatever their names.
 */
export function sizeProximity(before: number, after: number): number {
  const largest = Math.max(before, after);
  if (largest === 0) return 1;
  return 1 - Math.abs(after - before) / largest;
}

/**
 * A cheap content signature: `CHUNK_COUNT` evenly spaced slices, each reduced to a
 * 32-bit hash.
 *
 * Comparing signatures element-wise gives "what fraction of this file is unchanged"
 * without diffing it. It is deliberately coarse — an insertion near the start
 * shifts every later chunk and scores low, which is the right answer for *renamed
 * and rewritten*, and the wrong answer only for *renamed and shifted*, where the
 * name signal covers it.
 */
export function signatureOf(bytes: Uint8Array): number[] {
  if (bytes.byteLength === 0) return [];
  const size = Math.max(1, Math.floor(bytes.byteLength / CHUNK_COUNT));
  const signature: number[] = [];

  for (let index = 0; index < CHUNK_COUNT; index += 1) {
    const start = index * size;
    if (start >= bytes.byteLength) break;
    const end = Math.min(bytes.byteLength, start + size);
    // FNV-1a: no dependency, well distributed, and fast enough to run over a
    // couple of megabytes without anyone noticing.
    let hash = 0x811c9dc5;
    for (let at = start; at < end; at += 1) {
      hash ^= bytes[at] as number;
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    signature.push(hash);
  }

  return signature;
}

/** Share of chunks that match, positionally. */
export function signatureSimilarity(before: readonly number[], after: readonly number[]): number {
  if (before.length === 0 || after.length === 0) return 0;
  const shared = Math.min(before.length, after.length);
  let same = 0;
  for (let index = 0; index < shared; index += 1) {
    if (before[index] === after[index]) same += 1;
  }
  return same / Math.max(before.length, after.length);
}

/**
 * Scores one candidate pair from facts already gathered.
 *
 * Pure, so every rule below is testable without touching a disk.
 */
export function scorePair(
  removed: RenameEntry,
  added: RenameEntry,
  facts: {
    identical: boolean;
    similarity?: number;
  },
): { score: number; reason: RenamePair['reason'] } {
  if (facts.identical) return { score: 100, reason: 'identical' };

  const sameName = baseName(removed.path) === baseName(added.path);
  const moved = sameName && parentOf(removed.path) !== parentOf(added.path);
  const proximity = sizeProximity(removed.size, added.size);

  // A same-named file in a different directory is a move even when it was edited on
  // the way, so the name carries most of the weight and content adjusts it.
  if (moved) {
    const content = facts.similarity ?? proximity;
    return { score: Math.round(70 + 30 * content), reason: 'moved' };
  }

  // Renamed in place, or renamed and moved: only content can argue for it.
  const content = facts.similarity ?? 0;
  const score = Math.round(100 * (0.75 * content + 0.25 * proximity));
  return { score: sameName ? Math.max(score, 60) : score, reason: 'similar' };
}

interface Sampled {
  hash?: string;
  signature?: number[];
}

/**
 * Pairs removals with additions, best match first.
 *
 * Greedy rather than optimal: a global assignment would be a Hungarian-algorithm
 * problem for a heuristic nobody will audit. Sorting every candidate pair by score
 * and taking them in order gives the same answer on every real tree and is O(n log n)
 * once the scores exist.
 */
export async function detectRenamesV2(
  fs: HostFs | undefined,
  roots: { before: string; after: string },
  removals: readonly RenameEntry[],
  additions: readonly RenameEntry[],
  options: RenameOptions,
): Promise<{ pairs: RenamePair[]; notes: string[]; degraded: boolean }> {
  const notes: string[] = [];
  if (removals.length === 0 || additions.length === 0) {
    return { pairs: [], notes, degraded: false };
  }

  const pairCount = removals.length * additions.length;
  if (pairCount > MAX_PAIRS) {
    // Say so rather than quietly doing something cheaper: a user comparing two big
    // trees needs to know why the renames look worse than usual.
    notes.push(
      `${removals.length} removals × ${additions.length} additions is too many pairs to score — ` +
        `renames were matched by name and size only.`,
    );
    return { pairs: cheapPairs(removals, additions), notes, degraded: true };
  }

  const sampled = new Map<string, Sampled>();
  let unsampled = 0;
  let tooSmall = 0;

  const sample = async (root: string, entry: RenameEntry): Promise<Sampled> => {
    const key = `${root}/${entry.path}`;
    const cached = sampled.get(key);
    if (cached !== undefined) return cached;

    const facts: Sampled = {};
    if (fs !== undefined) {
      try {
        facts.hash = await fs.hashFile(key);
        if (entry.size < MIN_CONTENT_BYTES) {
          // Too small for a signature to mean anything; the name decides.
          tooSmall += 1;
        } else if (entry.size <= MAX_SAMPLED_BYTES) {
          facts.signature = signatureOf(await fs.readBytes(key));
        } else {
          unsampled += 1;
        }
      } catch {
        // An unreadable candidate simply scores on its name and size.
      }
    }
    sampled.set(key, facts);
    return facts;
  };

  const scored: RenamePair[] = [];

  for (const removed of removals) {
    const left = await sample(roots.before, removed);
    for (const added of additions) {
      const right = await sample(roots.after, added);

      const identical =
        left.hash !== undefined && right.hash !== undefined && left.hash === right.hash;
      const similarity =
        left.signature !== undefined && right.signature !== undefined
          ? signatureSimilarity(left.signature, right.signature)
          : undefined;

      const { score, reason } = scorePair(removed, added, {
        identical,
        ...(similarity !== undefined ? { similarity } : {}),
      });
      if (score >= options.threshold) {
        scored.push({ removed: removed.path, added: added.path, score, reason });
      }
    }
  }

  // Best first, then by path so the result is stable between runs.
  scored.sort(
    (one, two) =>
      two.score - one.score ||
      one.removed.localeCompare(two.removed) ||
      one.added.localeCompare(two.added),
  );

  const takenRemovals = new Set<string>();
  const takenAdditions = new Set<string>();
  const pairs: RenamePair[] = [];

  for (const candidate of scored) {
    if (takenRemovals.has(candidate.removed) || takenAdditions.has(candidate.added)) continue;
    takenRemovals.add(candidate.removed);
    takenAdditions.add(candidate.added);
    pairs.push(candidate);
  }

  if (tooSmall > 0) {
    notes.push(
      `${tooSmall} file${tooSmall === 1 ? ' was' : 's were'} too small (under ${MIN_CONTENT_BYTES} bytes) to compare by content — matched by name and size.`,
    );
  }
  if (unsampled > 0) {
    notes.push(
      `${unsampled} file${unsampled === 1 ? '' : 's'} over ${Math.round(MAX_SAMPLED_BYTES / (1024 * 1024))} MB were matched by hash and size only, not by content similarity.`,
    );
  }

  return { pairs, notes, degraded: false };
}

/** v1's rule, kept for the degraded path: same size, same folder. */
function cheapPairs(
  removals: readonly RenameEntry[],
  additions: readonly RenameEntry[],
): RenamePair[] {
  const taken = new Set<string>();
  const pairs: RenamePair[] = [];

  for (const removed of removals) {
    const match = additions.find(
      (added) =>
        !taken.has(added.path) &&
        added.size === removed.size &&
        parentOf(added.path) === parentOf(removed.path),
    );
    if (match === undefined) continue;
    taken.add(match.path);
    pairs.push({ removed: removed.path, added: match.path, score: 50, reason: 'similar' });
  }

  return pairs;
}

/** The note a paired row carries. The score is in it so a weak match reads as weak. */
export function renameNote(direction: 'from' | 'to', other: string, score: number): string {
  return `renamed ${direction} ${other} (${score}%)`;
}
