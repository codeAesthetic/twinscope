/**
 * Aligning two block indexes without comparing every block to every block.
 *
 * A gigabyte of log is roughly 156 000 blocks per side, and an LCS over that is
 * 24 billion comparisons — which is why MD §31 says *anchor on identical block
 * hashes* rather than "diff the blocks". The method here is patience alignment:
 *
 *  1. Keep only hashes that occur **exactly once on each side**. A hash that
 *     repeats (a run of blank lines, a repeated stack trace) says nothing about
 *     position, and pairing on it is how an alignment goes wrong.
 *  2. Those pair up unambiguously. Take the longest *increasing* subsequence of
 *     them, since an alignment cannot go backwards.
 *  3. Everything between two consecutive anchors is a window to diff properly.
 *
 * Both steps are O(n log n), and the result is exact where it claims to be: an
 * anchored block pair is byte-identical, never merely similar.
 */

export interface Anchor {
  a: number;
  b: number;
}

/** A run of blocks that matched, or a gap between two that did not. */
export interface AlignedSpan {
  kind: 'same' | 'diff';
  /** Half-open block ranges. A pure insertion has `aStart === aEnd`. */
  aStart: number;
  aEnd: number;
  bStart: number;
  bEnd: number;
}

function countOccurrences(hashes: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const hash of hashes) counts.set(hash, (counts.get(hash) ?? 0) + 1);
  return counts;
}

/**
 * Block pairs whose hash is unique on both sides, in an order both sides agree on.
 */
export function uniqueAnchors(hashesA: readonly string[], hashesB: readonly string[]): Anchor[] {
  const countsA = countOccurrences(hashesA);
  const countsB = countOccurrences(hashesB);

  const positionInB = new Map<string, number>();
  hashesB.forEach((hash, index) => {
    if (countsB.get(hash) === 1 && countsA.get(hash) === 1) positionInB.set(hash, index);
  });

  const candidates: Anchor[] = [];
  hashesA.forEach((hash, index) => {
    if (countsA.get(hash) !== 1) return;
    const b = positionInB.get(hash);
    if (b !== undefined) candidates.push({ a: index, b });
  });

  return longestIncreasing(candidates);
}

/**
 * The longest subsequence whose `b` values increase — patience sorting, so it is
 * O(n log n) rather than the quadratic dynamic-programming form.
 */
export function longestIncreasing(anchors: readonly Anchor[]): Anchor[] {
  if (anchors.length === 0) return [];

  // tails[k] = index into `anchors` of the smallest tail of an increasing run of
  // length k + 1. previous[i] = the anchor before i in the run ending at i.
  const tails: number[] = [];
  const previous = new Int32Array(anchors.length).fill(-1);

  for (let index = 0; index < anchors.length; index += 1) {
    const value = (anchors[index] as Anchor).b;

    let low = 0;
    let high = tails.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if ((anchors[tails[mid] as number] as Anchor).b < value) low = mid + 1;
      else high = mid;
    }

    if (low > 0) previous[index] = tails[low - 1] as number;
    tails[low] = index;
  }

  const out: Anchor[] = [];
  let cursor = tails[tails.length - 1] as number;
  while (cursor !== -1) {
    out.push(anchors[cursor] as Anchor);
    cursor = previous[cursor] as number;
  }
  return out.reverse();
}

/**
 * Anchors turned into a walk over both files: matched runs, and the gaps between.
 *
 * Consecutive anchors merge into one `same` span — a thousand identical blocks in
 * a row is one fold to the reader, not a thousand.
 */
export function alignBlocks(
  anchors: readonly Anchor[],
  blocksA: number,
  blocksB: number,
): AlignedSpan[] {
  const spans: AlignedSpan[] = [];
  let a = 0;
  let b = 0;

  for (const anchor of anchors) {
    if (anchor.a > a || anchor.b > b) {
      spans.push({ kind: 'diff', aStart: a, aEnd: anchor.a, bStart: b, bEnd: anchor.b });
      a = anchor.a;
      b = anchor.b;
    }

    const last = spans[spans.length - 1];
    if (last?.kind === 'same' && last.aEnd === a && last.bEnd === b) {
      last.aEnd += 1;
      last.bEnd += 1;
    } else {
      spans.push({ kind: 'same', aStart: a, aEnd: a + 1, bStart: b, bEnd: b + 1 });
    }
    a += 1;
    b += 1;
  }

  if (a < blocksA || b < blocksB) {
    spans.push({ kind: 'diff', aStart: a, aEnd: blocksA, bStart: b, bEnd: blocksB });
  }

  return spans;
}
