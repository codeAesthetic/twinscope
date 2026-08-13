import { describe, expect, it } from 'vitest';
import { alignBlocks, longestIncreasing, uniqueAnchors } from './anchors';

describe('uniqueAnchors', () => {
  it('pairs hashes that appear exactly once on each side', () => {
    expect(uniqueAnchors(['a', 'b', 'c'], ['a', 'x', 'c'])).toEqual([
      { a: 0, b: 0 },
      { a: 2, b: 2 },
    ]);
  });

  it('ignores a hash that repeats, however well it seems to match', () => {
    // A run of blank lines, or the same stack trace twice: identical content that
    // says nothing about position. Pairing on it is how an alignment goes wrong.
    expect(uniqueAnchors(['dup', 'dup', 'end'], ['dup', 'dup', 'end'])).toEqual([{ a: 2, b: 2 }]);
  });

  it('refuses to go backwards', () => {
    // 'a' and 'b' are swapped: only one of them can be an anchor.
    const anchors = uniqueAnchors(['a', 'b'], ['b', 'a']);
    expect(anchors).toHaveLength(1);
  });

  it('anchors a big insertion at both ends', () => {
    const before = ['h1', 'h2', 'h3'];
    const after = ['h1', 'new1', 'new2', 'h2', 'h3'];
    expect(uniqueAnchors(before, after)).toEqual([
      { a: 0, b: 0 },
      { a: 1, b: 3 },
      { a: 2, b: 4 },
    ]);
  });
});

describe('longestIncreasing', () => {
  it('keeps the longest run, not the first one', () => {
    const kept = longestIncreasing([
      { a: 0, b: 9 },
      { a: 1, b: 1 },
      { a: 2, b: 2 },
      { a: 3, b: 3 },
    ]);
    expect(kept.map((anchor) => anchor.b)).toEqual([1, 2, 3]);
  });

  it('handles an empty list', () => {
    expect(longestIncreasing([])).toEqual([]);
  });
});

describe('alignBlocks', () => {
  it('merges consecutive anchors into one span', () => {
    const spans = alignBlocks(
      [
        { a: 0, b: 0 },
        { a: 1, b: 1 },
        { a: 2, b: 2 },
      ],
      3,
      3,
    );
    expect(spans).toEqual([{ kind: 'same', aStart: 0, aEnd: 3, bStart: 0, bEnd: 3 }]);
  });

  it('describes an insertion as an empty range on the before side', () => {
    const spans = alignBlocks(
      [
        { a: 0, b: 0 },
        { a: 1, b: 3 },
      ],
      2,
      4,
    );
    expect(spans).toEqual([
      { kind: 'same', aStart: 0, aEnd: 1, bStart: 0, bEnd: 1 },
      { kind: 'diff', aStart: 1, aEnd: 1, bStart: 1, bEnd: 3 },
      { kind: 'same', aStart: 1, aEnd: 2, bStart: 3, bEnd: 4 },
    ]);
  });

  it('covers the tail when the last blocks do not anchor', () => {
    const spans = alignBlocks([{ a: 0, b: 0 }], 3, 5);
    expect(spans[spans.length - 1]).toEqual({
      kind: 'diff',
      aStart: 1,
      aEnd: 3,
      bStart: 1,
      bEnd: 5,
    });
  });

  it('is one whole-file window when nothing anchors', () => {
    expect(alignBlocks([], 4, 6)).toEqual([
      { kind: 'diff', aStart: 0, aEnd: 4, bStart: 0, bEnd: 6 },
    ]);
  });
});
