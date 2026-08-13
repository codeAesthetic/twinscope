import { describe, expect, it } from 'vitest';
import { isIdentical, painter, renderJson, renderSummary } from './report';
import type { DiffResult, InputRef } from '../engines/types';

const A: InputRef = { side: 'A', kind: 'json', name: 'before.json', path: '/tmp/a', size: 10 };
const B: InputRef = { side: 'B', kind: 'json', name: 'after.json', path: '/tmp/b', size: 12 };

const RESULT: DiffResult = {
  engineId: 'json',
  summary: {
    added: 2,
    removed: 1,
    modified: 3,
    extra: { identical: 4 },
    suppressed: 2,
  },
  data: { rows: [] },
  normalizationNotes: ['Ignored key order.'],
  timings: { ms: 42 },
};

const SAME: DiffResult = {
  ...RESULT,
  summary: { added: 0, removed: 0, modified: 0 },
  normalizationNotes: [],
};

const plain = painter(false);

describe('painter', () => {
  it('is a no-op when colour is off, so a piped report has no escapes', () => {
    expect(plain('hello', 'green')).toBe('hello');
  });

  it('wraps in the requested code when colour is on', () => {
    const colour = painter(true);
    expect(colour('hello', 'green')).toBe('\u001b[32mhello\u001b[0m');
  });
});

describe('isIdentical', () => {
  it('is true only when all three counts are zero', () => {
    expect(isIdentical({ added: 0, removed: 0, modified: 0 })).toBe(true);
    expect(isIdentical({ added: 0, removed: 0, modified: 1 })).toBe(false);
    // Suppressed differences are still not differences — that is the point of
    // suppressing them, and the exit code has to agree with the summary.
    expect(isIdentical({ added: 0, removed: 0, modified: 0, suppressed: 9 })).toBe(true);
  });
});

describe('renderSummary', () => {
  it('names both sides, the engine and the counts', () => {
    const text = renderSummary(RESULT, A, B, 'JSON structural diff', plain);
    expect(text).toContain('before.json → after.json');
    expect(text).toContain('JSON structural diff · 42 ms');
    expect(text).toContain('+2 added  -1 removed  ~3 modified');
  });

  it('prints extras and suppressed counts, which explain the numbers above', () => {
    const text = renderSummary(RESULT, A, B, 'JSON structural diff', plain);
    expect(text).toContain('identical: 4');
    expect(text).toContain('suppressed: 2');
  });

  it('lists every normalisation note — Rule 3 holds in a terminal too', () => {
    expect(renderSummary(RESULT, A, B, 'x', plain)).toContain('• Ignored key order.');
  });

  it('says so plainly when there is no difference', () => {
    const text = renderSummary(SAME, A, B, 'x', plain);
    expect(text).toContain('No differences.');
    expect(text).not.toContain('added');
  });

  it('ends with exactly one newline, so it composes in a shell', () => {
    const text = renderSummary(SAME, A, B, 'x', plain);
    expect(text.endsWith('\n')).toBe(true);
    expect(text.endsWith('\n\n')).toBe(false);
  });
});

describe('renderJson', () => {
  it('is parseable, and carries the verdict the exit code is based on', () => {
    const parsed = JSON.parse(renderJson(RESULT, A, B, 'JSON structural diff')) as {
      identical: boolean;
      engine: { id: string; label: string };
      summary: { added: number };
      before: { path: string | null; ref: string | null };
    };
    expect(parsed.identical).toBe(false);
    expect(parsed.engine).toEqual({ id: 'json', label: 'JSON structural diff' });
    expect(parsed.summary.added).toBe(2);
    expect(parsed.before.path).toBe('/tmp/a');
    // Absent rather than missing: a consumer should not have to distinguish
    // "no ref" from "the key was not written".
    expect(parsed.before.ref).toBeNull();
  });

  it('leaves the engine’s row model out — it is megabytes on a real diff', () => {
    const parsed = JSON.parse(renderJson(RESULT, A, B, 'x')) as Record<string, unknown>;
    expect(parsed.data).toBeUndefined();
    expect(parsed.rows).toBeUndefined();
  });

  it('reports a git ref when there is one', () => {
    const ref: InputRef = { ...A, kind: 'git', ref: 'main', name: 'repo @ main' };
    const parsed = JSON.parse(renderJson(RESULT, ref, B, 'Git ref diff')) as {
      before: { ref: string | null };
    };
    expect(parsed.before.ref).toBe('main');
  });
});
