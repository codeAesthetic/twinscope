import { describe, expect, it } from 'vitest';
import { countMatches, segmentRow, stripMarks } from './searchMatch';

/** The engine's word-level markers, as they appear inside row text. */
const marked = (text: string): string => `⟦${text}⟧`;

describe('stripMarks', () => {
  it('removes the encoding without touching the text', () => {
    expect(stripMarks(`const ${marked('timeout')} = 5;`)).toBe('const timeout = 5;');
  });
});

describe('countMatches', () => {
  it('counts every occurrence, case-insensitively', () => {
    expect(countMatches('Timeout and timeout and TIMEOUT', 'timeout')).toBe(3);
  });

  it('counts nothing for an empty query', () => {
    expect(countMatches('anything at all', '')).toBe(0);
  });

  it('finds a match that spans a mark boundary', () => {
    // The engine marked only "time"; searching "timeout" must still find it.
    expect(countMatches(`const ${marked('time')}out = 5;`, 'timeout')).toBe(1);
  });

  it('does not match the marker characters themselves', () => {
    expect(countMatches(marked('x'), '⟦')).toBe(0);
  });

  it('advances past a match rather than overlapping', () => {
    expect(countMatches('aaaa', 'aa')).toBe(2);
  });
});

describe('segmentRow', () => {
  const text = (segments: ReturnType<typeof segmentRow>): string =>
    segments.map((segment) => segment.text).join('');

  it('returns the original text, marks stripped', () => {
    const segments = segmentRow(`a ${marked('b')} c`, '');
    expect(text(segments)).toBe('a b c');
  });

  it('flags the marked run when there is no query', () => {
    const segments = segmentRow(`const ${marked('timeout')} = 5;`, '');
    expect(segments.filter((segment) => segment.marked).map((segment) => segment.text)).toEqual([
      'timeout',
    ]);
    expect(segments.every((segment) => !segment.hit)).toBe(true);
  });

  it('flags a search hit outside any mark', () => {
    const segments = segmentRow('const value = 5;', 'value');
    const hits = segments.filter((segment) => segment.hit);
    expect(hits.map((segment) => segment.text)).toEqual(['value']);
    expect(hits[0]?.marked).toBe(false);
  });

  it('keeps both flags where a hit sits inside a changed word', () => {
    // This is the case that made a single pass necessary: the run is both.
    const segments = segmentRow(`const ${marked('timeout')} = 5;`, 'timeout');
    const both = segments.filter((segment) => segment.marked && segment.hit);
    expect(both.map((segment) => segment.text)).toEqual(['timeout']);
  });

  it('splits a hit that only partly overlaps a mark', () => {
    // "time" is marked, "out" is not; searching "timeout" must produce two runs
    // that differ in `marked` but are both hits, and reassemble exactly.
    const segments = segmentRow(`${marked('time')}out`, 'timeout');
    expect(text(segments)).toBe('timeout');
    expect(segments.filter((segment) => segment.hit).map((segment) => segment.text)).toEqual([
      'time',
      'out',
    ]);
    expect(segments.map((segment) => segment.marked)).toEqual([true, false]);
    // Both runs belong to the same match, so cycling counts it once.
    expect(segments.map((segment) => segment.hitIndex)).toEqual([0, 0]);
  });

  it('numbers hits in order so the view can pick the current one', () => {
    const segments = segmentRow('one two one two one', 'one');
    expect(segments.filter((segment) => segment.hit).map((segment) => segment.hitIndex)).toEqual([
      0, 1, 2,
    ]);
  });

  it('offsets hit numbers, so the right side of a pair continues the left', () => {
    const segments = segmentRow('one and one', 'one', 5);
    expect(segments.filter((segment) => segment.hit).map((segment) => segment.hitIndex)).toEqual([
      5, 6,
    ]);
  });

  it('handles an empty row without inventing a segment', () => {
    expect(segmentRow('', 'x')).toEqual([]);
  });

  it('agrees with countMatches on how many matches a row holds', () => {
    const row = `${marked('time')}out and timeout again`;
    const distinct = new Set(
      segmentRow(row, 'timeout')
        .filter((segment) => segment.hit)
        .map((segment) => segment.hitIndex),
    );
    expect(distinct.size).toBe(countMatches(row, 'timeout'));
  });
});
