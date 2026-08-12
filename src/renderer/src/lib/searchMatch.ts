import { MARK_CLOSE, MARK_OPEN } from '../../../engines/text';

/**
 * Splitting a diff row into what the view has to paint (MVP-4's deferred ⌘F).
 *
 * Three systems overlap on the same text: the engine's word-level `⟦…⟧` marks
 * (*what changed*), the user's search matches (*what they are looking for*), and
 * syntax tokens (*what the code means*). Resolving them in one pass is what
 * keeps a search hit inside a changed keyword from losing any of the three.
 *
 * Pure and DOM-free so it can be tested directly — the view only maps segments
 * to spans.
 */

export interface Segment {
  text: string;
  /** Inside a `⟦…⟧` pair: a word the engine flagged as changed. */
  marked: boolean;
  /** Part of a search match. */
  hit: boolean;
  /**
   * 0-based index of the match this segment belongs to, counting from the start
   * of the row's text. `-1` when the segment is not a hit. The view needs it to
   * pick out the *current* match among several on one line.
   */
  hitIndex: number;
  /** Syntax colour, when a grammar is loaded and covers this run. */
  color?: string;
}

/** A syntax-highlighted range, in offsets into the stripped text. */
export interface TokenRange {
  start: number;
  end: number;
  color: string;
}

/** Marks travel inside the row text; nothing outside this module should see them. */
export function stripMarks(text: string): string {
  return text.split(MARK_OPEN).join('').split(MARK_CLOSE).join('');
}

/**
 * How many times `query` occurs in a row, ignoring the mark characters.
 *
 * Counted on the stripped text so a match is never split by a marker boundary:
 * searching for "timeout" must still find `⟦time⟧out`.
 */
export function countMatches(text: string, query: string): number {
  const needle = query.toLowerCase();
  if (needle === '') return 0;

  const haystack = stripMarks(text).toLowerCase();
  let count = 0;
  let at = haystack.indexOf(needle);
  while (at !== -1) {
    count += 1;
    at = haystack.indexOf(needle, at + needle.length);
  }
  return count;
}

/**
 * Splits one row into runs that are uniformly (marked?, hit?).
 *
 * Both systems are resolved against the *stripped* text, then re-zipped, which
 * is why a match spanning a mark boundary highlights correctly instead of
 * disappearing.
 */
export function segmentRow(
  text: string,
  query: string,
  hitOffset = 0,
  tokens: readonly TokenRange[] = [],
): Segment[] {
  const marks = markRanges(text);
  const stripped = stripMarks(text);
  const hits = hitRanges(stripped, query);

  // Every boundary from every system, so each run is uniform in all three.
  const bounds = new Set<number>([0, stripped.length]);
  for (const [start, end] of [...marks, ...hits]) {
    bounds.add(start);
    bounds.add(end);
  }
  for (const token of tokens) {
    bounds.add(token.start);
    bounds.add(token.end);
  }

  const edges = [...bounds].sort((one, two) => one - two);
  const segments: Segment[] = [];

  for (let index = 0; index < edges.length - 1; index += 1) {
    const start = edges[index] as number;
    const end = edges[index + 1] as number;
    if (end <= start) continue;

    const hit = hits.findIndex(([from, to]) => start >= from && end <= to);
    const token = tokens.find((range) => start >= range.start && end <= range.end);
    segments.push({
      text: stripped.slice(start, end),
      marked: marks.some(([from, to]) => start >= from && end <= to),
      hit: hit !== -1,
      hitIndex: hit === -1 ? -1 : hit + hitOffset,
      ...(token !== undefined ? { color: token.color } : {}),
    });
  }

  return segments;
}

/** Ranges of the *stripped* text that sat between `⟦` and `⟧`. */
function markRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let plain = 0;
  let open = -1;

  for (const character of text) {
    if (character === MARK_OPEN) {
      open = plain;
      continue;
    }
    if (character === MARK_CLOSE) {
      if (open !== -1) ranges.push([open, plain]);
      open = -1;
      continue;
    }
    plain += character.length;
  }

  return ranges;
}

function hitRanges(stripped: string, query: string): Array<[number, number]> {
  const needle = query.toLowerCase();
  if (needle === '') return [];

  const haystack = stripped.toLowerCase();
  const ranges: Array<[number, number]> = [];
  let at = haystack.indexOf(needle);
  while (at !== -1) {
    ranges.push([at, at + needle.length]);
    at = haystack.indexOf(needle, at + needle.length);
  }
  return ranges;
}
