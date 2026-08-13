import { describe, expect, it, vi } from 'vitest';
import { visualEngine, type VisualDiffData } from './index';
import type { DirEntry, EngineCtx, HostFs, ImageHost, InputRef, Raster } from '../types';

/**
 * The engine over a fake filesystem and a fake decoder — which is the whole point of
 * `EngineCtx`: no PNGs are encoded here, so the tests are about the pairing, the
 * budget and the sorting rather than about pixel formats.
 */

interface FakeImage {
  width: number;
  height: number;
  /** One byte per pixel, expanded to RGBA by the fake decoder. */
  fill: number;
}

function hostOf(tree: Record<string, FakeImage | 'broken'>): {
  fs: HostFs;
  image: ImageHost;
} {
  const listing = (root: string): DirEntry[] => {
    const seen = new Map<string, DirEntry>();
    for (const path of Object.keys(tree)) {
      if (!path.startsWith(`${root}/`)) continue;
      const rest = path.slice(root.length + 1);
      const cut = rest.indexOf('/');
      const name = cut === -1 ? rest : rest.slice(0, cut);
      seen.set(name, {
        name,
        path: `${root}/${name}`,
        isDirectory: cut !== -1,
        isSymlink: false,
      });
    }
    return [...seen.values()];
  };

  return {
    fs: {
      listDir: (path) => Promise.resolve(listing(path)),
      readBytes: (path) => {
        const entry = tree[path];
        if (entry === undefined) return Promise.reject(new Error('missing'));
        if (entry === 'broken') return Promise.resolve(new Uint8Array([1, 2, 3]));
        return Promise.resolve(new Uint8Array([entry.width, entry.height, entry.fill]));
      },
      readText: () => Promise.reject(new Error('not used')),
      stat: () => Promise.resolve({ size: 0, mtimeMs: 0 }),
      hashFile: () => Promise.resolve(''),
    },
    image: {
      decode: (bytes) => {
        const [width, height, fill] = [bytes[0] ?? 0, bytes[1] ?? 0, bytes[2] ?? 0];
        if (width === 1 && height === 2) return Promise.reject(new Error('cannot decode this'));
        const data = new Uint8ClampedArray(width * height * 4).fill(fill);
        return Promise.resolve({
          width,
          height,
          data,
          natural: [width, height] as [number, number],
        });
      },
      encodePng: () => Promise.resolve('data:,'),
    },
  };
}

function ctxWith(fs: HostFs, image: ImageHost | undefined): EngineCtx {
  return {
    signal: new AbortController().signal,
    progress: vi.fn(),
    fs,
    ...(image !== undefined ? { image } : {}),
  };
}

function folder(side: 'A' | 'B', path: string): InputRef {
  return { side, kind: 'folder', name: path, path, size: 0 };
}

async function run(
  tree: Record<string, FakeImage | 'broken'>,
  options: Partial<Parameters<typeof visualEngine.compare>[2]> = {},
) {
  const host = hostOf(tree);
  const result = await visualEngine.compare(
    folder('A', '/base'),
    folder('B', '/current'),
    { ...visualEngine.defaultOptions(), ...options },
    ctxWith(host.fs, host.image),
  );
  return { result, data: result.data as VisualDiffData };
}

describe('visualEngine', () => {
  it('pairs screenshots on their relative path, however deep', async () => {
    const { data } = await run({
      '/base/home.png': { width: 4, height: 4, fill: 10 },
      '/current/home.png': { width: 4, height: 4, fill: 10 },
      '/base/pages/about.png': { width: 4, height: 4, fill: 10 },
      '/current/pages/about.png': { width: 4, height: 4, fill: 200 },
    });

    expect(data.rows.map((row) => row.path).sort()).toEqual(['home.png', 'pages/about.png']);
    expect(data.rows.find((row) => row.path === 'home.png')?.state).toBe('same');
    expect(data.rows.find((row) => row.path === 'pages/about.png')?.state).toBe('changed');
  });

  it('reports a shot present on one side only rather than as a difference', async () => {
    const { data, result } = await run({
      '/base/gone.png': { width: 2, height: 2, fill: 1 },
      '/current/new.png': { width: 2, height: 2, fill: 1 },
    });
    expect(data.rows.find((row) => row.path === 'gone.png')?.state).toBe('removed');
    expect(data.rows.find((row) => row.path === 'new.png')?.state).toBe('added');
    expect(result.summary.modified).toBe(0);
  });

  it('gates on the worst screenshot, and counts the ones over budget', async () => {
    const { result, data } = await run({
      '/base/a.png': { width: 4, height: 4, fill: 0 },
      '/current/a.png': { width: 4, height: 4, fill: 255 },
      '/base/b.png': { width: 4, height: 4, fill: 0 },
      '/current/b.png': { width: 4, height: 4, fill: 0 },
    });
    expect(result.summary.extra?.['worst difference']).toBe('100.00%');
    expect(result.summary.extra?.['over budget']).toBe(1);
    expect(data.worst).toBe(100);
  });

  it('sorts the worst shot first, because that is the one being looked for', async () => {
    const { data } = await run({
      '/base/zzz.png': { width: 4, height: 4, fill: 0 },
      '/current/zzz.png': { width: 4, height: 4, fill: 255 },
      '/base/aaa.png': { width: 4, height: 4, fill: 0 },
      '/current/aaa.png': { width: 4, height: 4, fill: 0 },
    });
    expect(data.rows[0]?.path).toBe('zzz.png');
  });

  it('keeps going when one pair cannot be decoded, and says why', async () => {
    const { data, result } = await run({
      // 1×2 is the fake decoder's failure case.
      '/base/broken.png': { width: 1, height: 2, fill: 0 },
      '/current/broken.png': { width: 1, height: 2, fill: 0 },
      '/base/fine.png': { width: 4, height: 4, fill: 0 },
      '/current/fine.png': { width: 4, height: 4, fill: 255 },
    });

    const broken = data.rows.find((row) => row.path === 'broken.png');
    expect(broken?.state).toBe('failed');
    expect(broken?.note).toMatch(/cannot decode/);
    // The other 399 still carry the answer.
    expect(data.rows.find((row) => row.path === 'fine.png')?.state).toBe('changed');
    expect(result.summary.extra?.['unreadable']).toBe(1);
    expect(result.normalizationNotes.join(' ')).toMatch(/could not be compared/);
  });

  it('compares mismatched sizes on the union, as the image engine does', async () => {
    const { data } = await run({
      // A bright fill, because padding is transparent black: a fill of 5 differs from
      // the padding by 2% of a channel, which is *below* the 10% per-pixel threshold —
      // correct behaviour, and a fixture that proved nothing.
      '/base/grew.png': { width: 2, height: 2, fill: 200 },
      '/current/grew.png': { width: 4, height: 4, fill: 200 },
    });
    const row = data.rows[0];
    // The padded area differs, so a screenshot that grew is a regression, not an error.
    expect(row?.state).toBe('changed');
    expect(row?.dims).toEqual({ before: [2, 2], after: [4, 4] });
  });

  it('skips ignored paths', async () => {
    const { data } = await run(
      {
        '/base/keep.png': { width: 2, height: 2, fill: 1 },
        '/current/keep.png': { width: 2, height: 2, fill: 2 },
        '/base/flaky/map.png': { width: 2, height: 2, fill: 1 },
        '/current/flaky/map.png': { width: 2, height: 2, fill: 9 },
      },
      { ignore: ['flaky/*'] },
    );
    expect(data.rows.map((row) => row.path)).toEqual(['keep.png']);
  });

  it('caps a run and says how many it left out', async () => {
    const tree: Record<string, FakeImage> = {};
    for (let at = 0; at < 6; at += 1) {
      tree[`/base/shot${at}.png`] = { width: 2, height: 2, fill: 1 };
      tree[`/current/shot${at}.png`] = { width: 2, height: 2, fill: 1 };
    }
    const { data, result } = await run(tree, { maxImages: 2 });
    expect(data.rows).toHaveLength(2);
    expect(result.normalizationNotes.join(' ')).toMatch(/4 further screenshots/);
  });

  it('refuses a host with no decoder, and names the command line', async () => {
    const host = hostOf({});
    await expect(
      visualEngine.compare(
        folder('A', '/base'),
        folder('B', '/current'),
        visualEngine.defaultOptions(),
        ctxWith(host.fs, undefined),
      ),
    ).rejects.toMatchObject({
      name: 'EngineInputError',
      fallback: { fallbackEngineId: 'folder' },
    });
  });

  it('never wins detection, since two folders of source look the same from outside', () => {
    expect(visualEngine.meta.priority).toBe(0);
    expect(visualEngine.canHandle(folder('A', '/a'), folder('B', '/b'))).toBe(true);
    expect(
      visualEngine.canHandle(
        { side: 'A', kind: 'image', name: 'a.png', size: 1 },
        folder('B', '/b'),
      ),
    ).toBe(false);
  });

  it('scores the visual axis, which is the one it exists for', async () => {
    const { result } = await run({
      '/base/a.png': { width: 4, height: 4, fill: 0 },
      '/current/a.png': { width: 4, height: 4, fill: 255 },
    });
    expect(result.summary.radar?.['visual']).toBe(100);
  });
});

/** Kept honest: the fake decoder's raster shape has to match the real one. */
it('the fake decoder produces the same shape as a real one', async () => {
  const host = hostOf({ '/base/x.png': { width: 3, height: 2, fill: 7 } });
  const raster: Raster = await host.image.decode(new Uint8Array([3, 2, 7]), 2000);
  expect(raster.data).toHaveLength(3 * 2 * 4);
});
