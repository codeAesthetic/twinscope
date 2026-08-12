import { describe, expect, it } from 'vitest';
import { diffText, markWords, similarity, MARK_CLOSE, MARK_OPEN } from './textDiff';
import type { TextDiffOptions } from './textDiff';

const options = (overrides: Partial<TextDiffOptions> = {}): TextDiffOptions => ({
  ignoreWhitespace: false,
  ignoreCase: false,
  collapseUnchanged: false,
  ...overrides,
});

const kinds = (before: string, after: string, opts = options()): string[] =>
  diffText(before, after, opts).data.rows.map((row) => row.kind);

describe('line diff', () => {
  it('reports identical input as all context', () => {
    const { data, stats } = diffText('a\nb\nc', 'a\nb\nc', options());
    expect(data.rows.every((row) => row.kind === 'ctx')).toBe(true);
    expect(stats).toEqual({ added: 0, removed: 0, modified: 0 });
  });

  it('numbers lines independently per side', () => {
    const { data } = diffText('keep\ngone\nkeep2', 'keep\nkeep2', options());
    const removed = data.rows.find((row) => row.kind === 'del');
    expect(removed?.left).toBe(2);
    expect(removed?.right).toBeUndefined();

    const last = data.rows.at(-1);
    expect(last?.left).toBe(3);
    expect(last?.right).toBe(2);
  });

  it('detects a pure addition', () => {
    expect(kinds('a', 'a\nb')).toEqual(['ctx', 'add']);
  });

  it('detects a pure deletion', () => {
    expect(kinds('a\nb', 'a')).toEqual(['ctx', 'del']);
  });
});

describe('modification pairing', () => {
  /** The layer that makes a diff readable rather than a wall of del/add. */
  it('pairs an edited line into a single mod row', () => {
    const { data, stats } = diffText('const timeout = 5000;', 'const timeout = 8000;', options());
    expect(data.rows.map((row) => row.kind)).toEqual(['mod']);
    expect(stats).toEqual({ added: 0, removed: 0, modified: 1 });
  });

  it('marks only the words that changed', () => {
    const { data } = diffText('const timeout = 5000;', 'const timeout = 8000;', options());
    const row = data.rows[0]!;
    expect(row.text).toBe(`const timeout = ${MARK_OPEN}5000${MARK_CLOSE};`);
    expect(row.textRight).toBe(`const timeout = ${MARK_OPEN}8000${MARK_CLOSE};`);
  });

  it('keeps unrelated lines separate instead of forcing a pair', () => {
    expect(kinds('the quick brown fox', 'entirely different content here')).toEqual(['del', 'add']);
  });

  it('handles an uneven run: two removed, one added', () => {
    const rows = kinds('one edited\ntwo removed\nkeep', 'one edited!\nkeep');
    expect(rows).toEqual(['mod', 'del', 'ctx']);
  });

  it('handles an uneven run: one removed, two added', () => {
    const rows = kinds('one edited\nkeep', 'one edited!\nbrand new\nkeep');
    expect(rows).toEqual(['mod', 'add', 'ctx']);
  });
});

describe('normalisation', () => {
  it('always normalises line endings', () => {
    const { stats, notes } = diffText('a\r\nb', 'a\nb', options());
    expect(stats).toEqual({ added: 0, removed: 0, modified: 0 });
    expect(notes[0]).toMatch(/CRLF/);
  });

  it('ignoreWhitespace treats reindented lines as unchanged', () => {
    expect(
      kinds('  const a = 1;', '\tconst   a = 1;', options({ ignoreWhitespace: true })),
    ).toEqual(['ctx']);
  });

  it('without ignoreWhitespace the same pair is a modification', () => {
    expect(kinds('  const a = 1;', '\tconst   a = 1;')).toEqual(['mod']);
  });

  it('ignoreCase treats case-only changes as unchanged', () => {
    expect(kinds('Hello World', 'hello world', options({ ignoreCase: true }))).toEqual(['ctx']);
  });

  /** Rule 3: normalisation that changed the outcome has to be reportable. */
  it('lists every applied normalisation', () => {
    const { notes } = diffText('a', 'b', options({ ignoreWhitespace: true, ignoreCase: true }));
    expect(notes.join(' ')).toMatch(/whitespace/i);
    expect(notes.join(' ')).toMatch(/case/i);
  });

  it('displays the original text, not the normalised key', () => {
    const { data } = diffText('  spaced  ', 'x', options({ ignoreWhitespace: true }));
    expect(data.rows.some((row) => row.text.includes('  spaced  '))).toBe(true);
  });
});

describe('folding', () => {
  const long = (count: number): string =>
    Array.from({ length: count }, (_, index) => `line ${index}`).join('\n');

  it('collapses a long unchanged run, keeping context at both ends', () => {
    const before = `changed\n${long(20)}`;
    const after = `changed!\n${long(20)}`;
    const { data } = diffText(before, after, options({ collapseUnchanged: true }));

    const fold = data.rows.find((row) => row.kind === 'fold');
    expect(fold?.count).toBe(14); // 20 context lines, 3 kept at each end
    expect(fold?.hidden).toHaveLength(14);
    // Expanding must be instant, so the hidden rows are already built.
    expect(fold?.hidden?.[0]?.kind).toBe('ctx');
  });

  it('leaves short runs alone', () => {
    const { data } = diffText(
      `changed\n${long(4)}`,
      `changed!\n${long(4)}`,
      options({ collapseUnchanged: true }),
    );
    expect(data.rows.some((row) => row.kind === 'fold')).toBe(false);
  });

  it('does not fold when the option is off', () => {
    const { data } = diffText(`x\n${long(50)}`, `y\n${long(50)}`, options());
    expect(data.rows.some((row) => row.kind === 'fold')).toBe(false);
  });
});

describe('guards', () => {
  it('refuses input beyond the interactive limit', () => {
    const huge = Array.from({ length: 200_001 }, () => 'x').join('\n');
    expect(() => diffText(huge, huge, options())).toThrow(/too large/i);
  });

  it('skips intraline marking on pathologically long lines', () => {
    const long = 'x'.repeat(3000);
    const [left, right] = markWords(long, `${long}y`);
    expect(left).not.toContain(MARK_OPEN);
    expect(right).not.toContain(MARK_OPEN);
  });
});

describe('similarity', () => {
  it('scores an edited line high and an unrelated one low', () => {
    expect(similarity('const a = 1;', 'const a = 2;')).toBeGreaterThan(0.5);
    expect(similarity('const a = 1;', 'completely unrelated text')).toBeLessThan(0.2);
  });

  it('scores empty input as zero rather than dividing by zero', () => {
    expect(similarity('', 'anything')).toBe(0);
    expect(similarity('anything', '')).toBe(0);
  });
});
