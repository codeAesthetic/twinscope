import { describe, expect, it, vi } from 'vitest';
import { largeTextEngine, LARGE_BYTES } from './index';
import { DEFAULT_TEXT_OPTIONS } from '../text/textDiff';
import type { TextDiffData, TextRow } from '../text/textDiff';
import type { EngineCtx, HostFs, InputRef } from '../types';

/** A `HostFs` over strings, with the ranged read this engine is built on. */
function hostOf(files: Record<string, string>, options: { withRange?: boolean } = {}): HostFs {
  const bytes = new Map(
    Object.entries(files).map(([path, text]) => [path, new TextEncoder().encode(text)]),
  );
  const host: HostFs = {
    readText: (path) => Promise.resolve(files[path] ?? ''),
    readBytes: (path) => Promise.resolve(bytes.get(path) ?? new Uint8Array()),
    listDir: () => Promise.resolve([]),
    stat: (path) =>
      Promise.resolve({ size: (bytes.get(path) ?? new Uint8Array()).length, mtimeMs: 0 }),
    hashFile: () => Promise.resolve(''),
  };
  if (options.withRange !== false) {
    host.readRange = (path, start, length) =>
      Promise.resolve((bytes.get(path) ?? new Uint8Array()).subarray(start, start + length));
  }
  return host;
}

function ctxWith(fs: HostFs): EngineCtx {
  return { signal: new AbortController().signal, progress: vi.fn(), fs };
}

function refOf(side: 'A' | 'B', path: string, size: number): InputRef {
  return { side, kind: 'text', name: path, path, size };
}

function lines(from: number, to: number, prefix = 'line'): string {
  const out: string[] = [];
  for (let at = from; at <= to; at += 1) out.push(`${prefix} ${at}`);
  return `${out.join('\n')}\n`;
}

async function run(
  before: string,
  after: string,
  overrides: Partial<typeof DEFAULT_TEXT_OPTIONS> = {},
) {
  const fs = hostOf({ '/a.log': before, '/b.log': after });
  const result = await largeTextEngine.compare(
    refOf('A', '/a.log', before.length),
    refOf('B', '/b.log', after.length),
    { ...DEFAULT_TEXT_OPTIONS, ...overrides },
    ctxWith(fs),
  );
  return { result, data: result.data as TextDiffData };
}

describe('largeTextEngine.canHandle', () => {
  it('claims a textual pair only when a side is genuinely large and on disk', () => {
    const big = refOf('A', '/a.log', LARGE_BYTES + 1);
    const small = refOf('B', '/b.log', 10);
    expect(largeTextEngine.canHandle(big, small)).toBe(true);
    expect(largeTextEngine.canHandle(small, small)).toBe(false);

    // A pasted 20 MB string has no path, so there is nothing to read ranges from.
    const pasted: InputRef = { side: 'B', kind: 'text', name: 'clipboard', size: LARGE_BYTES + 1 };
    expect(largeTextEngine.canHandle(big, pasted)).toBe(false);
    expect(largeTextEngine.canHandle(big, { ...small, kind: 'image' })).toBe(false);
  });
});

describe('largeTextEngine', () => {
  it('answers identical files from the index alone', async () => {
    const text = lines(1, 400);
    const { result, data } = await run(text, text);
    expect(result.summary).toMatchObject({ added: 0, removed: 0, modified: 0 });
    expect(data.rows).toEqual([]);
    expect(result.normalizationNotes[0]).toMatch(/identical/i);
  });

  it('folds the unchanged span and diffs only the window around the change', async () => {
    const before = `${lines(1, 400)}`;
    const after = before.replace('line 250', 'line 250 CHANGED');
    const { result, data } = await run(before, after);

    expect(result.summary.modified).toBe(1);
    expect(result.summary.added + result.summary.removed).toBe(0);

    // The changed line keeps its real number in the whole file, not the window's.
    const modified = data.rows.find((row) => row.kind === 'mod') as TextRow;
    expect(modified.left).toBe(250);
    expect(modified.right).toBe(250);

    // Everything outside the window is a fold with a byte range and no rows.
    const folds = data.rows.filter((row) => row.kind === 'fold' && row.range !== undefined);
    expect(folds.length).toBeGreaterThan(0);
    expect(folds.every((row) => row.hidden === undefined)).toBe(true);
    expect(folds[0]?.range?.path).toBe('/a.log');
  });

  it('a fold range reads back exactly the lines it claims', async () => {
    const before = lines(1, 400);
    const after = before.replace('line 380', 'line 380 CHANGED');
    const fs = hostOf({ '/a.log': before, '/b.log': after });
    const result = await largeTextEngine.compare(
      refOf('A', '/a.log', before.length),
      refOf('B', '/b.log', after.length),
      { ...DEFAULT_TEXT_OPTIONS },
      ctxWith(fs),
    );
    const fold = (result.data as TextDiffData).rows.find(
      (row) => row.range !== undefined,
    ) as TextRow;
    const range = fold.range as { path: string; start: number; end: number };

    const slice = new TextDecoder().decode(
      await (fs.readRange as NonNullable<HostFs['readRange']>)(
        range.path,
        range.start,
        range.end - range.start,
      ),
    );
    // The fold says it starts at line `left` and hides `count` lines: both have to
    // be true of the bytes, or an expanded fold shows the wrong part of the file.
    expect(slice.split('\n')[0]).toBe(`line ${fold.left}`);
    expect(slice.replace(/\n$/, '').split('\n')).toHaveLength(fold.count as number);
  });

  it('finds a change in a file with no anchors at all', async () => {
    // Two short files: nothing to anchor on, so the whole pair is one window.
    const { result } = await run('alpha\nbeta\n', 'alpha\ngamma\n');
    expect(result.summary.modified + result.summary.added + result.summary.removed).toBeGreaterThan(
      0,
    );
  });

  it('reports an insertion once rather than shifting every later line', async () => {
    const before = lines(1, 600);
    const after = before.replace('line 300\n', 'line 300\nINSERTED\n');
    const { result } = await run(before, after);
    expect(result.summary.added).toBe(1);
    expect(result.summary.removed).toBe(0);
  });

  it('says that anchoring is exact, and treats a case-only change as a region', async () => {
    const before = lines(1, 400);
    const after = before.replace('line 100', 'LINE 100');
    const { result } = await run(before, after, { ignoreCase: true });

    // ignoreCase applies inside the window, so the difference is suppressed there…
    expect(result.summary.modified).toBe(0);
    // …but the note has to say the block still failed to anchor, or a reader cannot
    // explain why a case-insensitive comparison did any work at all.
    expect(result.normalizationNotes.join(' ')).toMatch(/byte-exact/i);
  });

  it('refuses UTF-16 by name, and offers the text engine', async () => {
    const utf16 = String.fromCharCode(0xff, 0xfe) + 'a\0b\0c\0d\0e\0f\0g\0h\0i\0j\0';
    const fs = hostOf({ '/a.log': utf16, '/b.log': utf16 + 'x' });
    await expect(
      largeTextEngine.compare(
        refOf('A', '/a.log', 40),
        refOf('B', '/b.log', 41),
        { ...DEFAULT_TEXT_OPTIONS },
        ctxWith(fs),
      ),
    ).rejects.toMatchObject({
      name: 'EngineInputError',
      fallback: { fallbackEngineId: 'text' },
    });
  });

  it('refuses a host with no ranged read, rather than reading the file whole', async () => {
    const fs = hostOf({ '/a.log': 'a\n', '/b.log': 'b\n' }, { withRange: false });
    await expect(
      largeTextEngine.compare(
        refOf('A', '/a.log', 2),
        refOf('B', '/b.log', 2),
        { ...DEFAULT_TEXT_OPTIONS },
        ctxWith(fs),
      ),
    ).rejects.toMatchObject({ name: 'EngineInputError' });
  });

  it('keeps every fold small enough to be opened', async () => {
    // A 6 MB unchanged run would be one fold past the view's 4 MB load cap, and so
    // permanently shut. It has to arrive as several openable folds instead.
    // Distinct lines: 50 000 *identical* ones would share every block hash, and a
    // repeated hash is deliberately never an anchor (see `uniqueAnchors`).
    const filler = lines(1, 50_000, `${'x'.repeat(110)} row`);
    const before = `${filler}tail before\n`;
    const after = `${filler}tail after\n`;
    const { data } = await run(before, after);

    const folds = data.rows.filter((row) => row.kind === 'fold' && row.range !== undefined);
    expect(folds.length).toBeGreaterThan(1);
    for (const fold of folds) {
      const range = fold.range as { start: number; end: number };
      expect(range.end - range.start).toBeLessThanOrEqual(4 * 1024 * 1024);
    }
    // Together they still account for every line they claim to hide, in order.
    let line = 1;
    for (const fold of folds) {
      expect(fold.left).toBe(line);
      line += fold.count as number;
    }
  });

  it('scores only the two axes a line diff can measure', async () => {
    const before = lines(1, 400);
    const { result } = await run(before, before.replace('line 12', 'line 12 x'));
    expect(Object.keys(result.summary.radar ?? {}).sort()).toEqual(['content', 'structure']);
  });
});
