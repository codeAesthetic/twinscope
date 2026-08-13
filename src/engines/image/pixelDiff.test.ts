import { describe, expect, it } from 'vitest';
import { clusterRegions, padTo, paintMask, pixelDiff } from './pixelDiff';
import { imageEngine } from './index';
import type { EngineCtx, HostFs, ImageHost, InputRef, Raster } from '../types';

/** A solid canvas to draw test shapes onto. */
function canvas(
  width: number,
  height: number,
  fill: [number, number, number, number] = [0, 0, 0, 255],
) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    data.set(fill, pixel * 4);
  }
  return { width, height, data };
}

function rect(
  raster: { width: number; data: Uint8ClampedArray },
  x: number,
  y: number,
  width: number,
  height: number,
  colour: [number, number, number, number],
): void {
  for (let row = y; row < y + height; row += 1) {
    for (let column = x; column < x + width; column += 1) {
      raster.data.set(colour, (row * raster.width + column) * 4);
    }
  }
}

const WHITE: [number, number, number, number] = [255, 255, 255, 255];

describe('pixelDiff', () => {
  it('finds no difference between identical buffers', () => {
    const before = canvas(20, 20);
    const after = canvas(20, 20);
    const { diffPixels } = pixelDiff(before.data, after.data, 20, 20, { threshold: 0.12 });
    expect(diffPixels).toBe(0);
  });

  it('counts exactly the pixels that changed', () => {
    const before = canvas(20, 20);
    const after = canvas(20, 20);
    rect(after, 4, 4, 3, 2, WHITE);

    const { diffPixels, mask } = pixelDiff(before.data, after.data, 20, 20, { threshold: 0.12 });
    expect(diffPixels).toBe(6);
    expect(mask[4 * 20 + 4]).toBe(1);
    expect(mask[0]).toBe(0);
  });

  it('gets stricter as the threshold drops', () => {
    const before = canvas(10, 10, [100, 100, 100, 255]);
    const after = canvas(10, 10, [120, 120, 120, 255]);

    // 60 of a possible 1020 — under a 12% tolerance, over a 1% one.
    expect(pixelDiff(before.data, after.data, 10, 10, { threshold: 0.12 }).diffPixels).toBe(0);
    expect(pixelDiff(before.data, after.data, 10, 10, { threshold: 0.01 }).diffPixels).toBe(100);
  });

  it('sees a change in alpha alone', () => {
    const before = canvas(4, 4, [255, 0, 0, 255]);
    const after = canvas(4, 4, [255, 0, 0, 0]);
    expect(pixelDiff(before.data, after.data, 4, 4, { threshold: 0.12 }).diffPixels).toBe(16);
  });
});

describe('clusterRegions', () => {
  it('groups one changed blob into one region', () => {
    const before = canvas(200, 200);
    const after = canvas(200, 200);
    rect(after, 20, 20, 40, 40, WHITE);

    const { mask } = pixelDiff(before.data, after.data, 200, 200, { threshold: 0.12 });
    const regions = clusterRegions(mask, 200, 200);

    expect(regions).toHaveLength(1);
    const region = regions[0]!;
    expect(region.left).toBeGreaterThanOrEqual(0);
    expect(region.left).toBeLessThanOrEqual(20);
    expect(region.width).toBeGreaterThan(15);
    expect(region.pixels).toBe(1600);
  });

  it('keeps well-separated blobs apart', () => {
    const before = canvas(200, 200);
    const after = canvas(200, 200);
    rect(after, 10, 10, 30, 30, WHITE);
    rect(after, 150, 150, 30, 30, WHITE);

    const { mask } = pixelDiff(before.data, after.data, 200, 200, { threshold: 0.12 });
    expect(clusterRegions(mask, 200, 200)).toHaveLength(2);
  });

  it('ignores speckle too sparse to be a real change', () => {
    const before = canvas(200, 200);
    const after = canvas(200, 200);
    // One isolated pixel per cell is below the 3% occupancy floor.
    rect(after, 7, 7, 1, 1, WHITE);

    const { mask } = pixelDiff(before.data, after.data, 200, 200, { threshold: 0.12 });
    expect(clusterRegions(mask, 200, 200)).toHaveLength(0);
  });

  it('returns the biggest regions first, capped', () => {
    const before = canvas(400, 400);
    const after = canvas(400, 400);
    rect(after, 10, 10, 20, 20, WHITE);
    rect(after, 200, 200, 60, 60, WHITE);

    const { mask } = pixelDiff(before.data, after.data, 400, 400, { threshold: 0.12 });
    const regions = clusterRegions(mask, 400, 400, 1);

    expect(regions).toHaveLength(1);
    expect(regions[0]!.pixels).toBe(3600);
  });
});

describe('padTo', () => {
  it('returns the same buffer when no padding is needed', () => {
    const raster = canvas(4, 4);
    expect(padTo(raster, 4, 4)).toBe(raster.data);
  });

  it('places the original at the top-left and leaves the rest transparent', () => {
    const raster = canvas(2, 2, WHITE);
    const padded = padTo(raster, 4, 4);

    expect(padded).toHaveLength(4 * 4 * 4);
    expect([...padded.slice(0, 4)]).toEqual([255, 255, 255, 255]);
    // The padded column on the first row is untouched, so fully transparent.
    expect([...padded.slice(8, 12)]).toEqual([0, 0, 0, 0]);
  });
});

describe('paintMask', () => {
  it('marks changed pixels and dims the rest', () => {
    const before = canvas(2, 1, [200, 200, 200, 255]);
    const mask = new Uint8Array([1, 0]);
    const painted = paintMask(before.data, mask, 2, 1);

    expect([...painted.slice(0, 4)]).toEqual([255, 79, 216, 235]);
    expect(painted[4]).toBeLessThan(100);
    expect(painted[7]).toBe(255);
  });
});

describe('imageEngine', () => {
  const ref = (side: 'A' | 'B', name: string): InputRef => ({
    side,
    kind: 'image',
    name,
    path: `/tmp/${name}`,
    size: 1,
  });

  /** A fake decoder: the bytes are an index into two prepared rasters. */
  function host(rasters: Record<string, Raster & { natural: [number, number] }>): {
    fs: HostFs;
    image: ImageHost;
  } {
    return {
      fs: {
        readBytes: (path) => Promise.resolve(new TextEncoder().encode(path)),
        readText: () => Promise.reject(new Error('no')),
        listDir: () => Promise.reject(new Error('no')),
        stat: () => Promise.reject(new Error('no')),
        hashFile: () => Promise.reject(new Error('no')),
      },
      image: {
        decode: (bytes) => {
          const path = new TextDecoder().decode(bytes);
          const raster = rasters[path];
          if (raster === undefined) throw new Error(`no raster for ${path}`);
          return Promise.resolve(raster);
        },
        encodePng: () => Promise.resolve('data:image/png;base64,stub'),
      },
    };
  }

  const ctx = (extras: Partial<EngineCtx>): EngineCtx => ({
    signal: new AbortController().signal,
    progress: () => undefined,
    ...extras,
  });

  it('claims two images and nothing else', () => {
    expect(imageEngine.canHandle(ref('A', 'a.png'), ref('B', 'b.png'))).toBe(true);
    expect(imageEngine.canHandle({ ...ref('A', 'a.png'), kind: 'text' }, ref('B', 'b.png'))).toBe(
      false,
    );
  });

  it('reports the changed percentage and one region per blob', async () => {
    const before = { ...canvas(100, 100), natural: [100, 100] as [number, number] };
    const after = { ...canvas(100, 100), natural: [100, 100] as [number, number] };
    rect(after, 10, 10, 20, 20, WHITE);

    const result = await imageEngine.compare(
      ref('A', 'a.png'),
      ref('B', 'b.png'),
      imageEngine.defaultOptions(),
      ctx(host({ '/tmp/a.png': before, '/tmp/b.png': after })),
    );

    const data = result.data;
    expect(data.diffPixels).toBe(400);
    expect(data.pct).toBeCloseTo(4, 5);
    expect(data.regions).toHaveLength(1);
    expect(result.summary.extra?.difference).toBe('4.00%');
    expect(result.summary.modified).toBe(1);
  });

  it('compares mismatched sizes on the union and says so', async () => {
    const before = { ...canvas(50, 50, WHITE), natural: [50, 50] as [number, number] };
    const after = { ...canvas(100, 50, WHITE), natural: [100, 50] as [number, number] };

    const result = await imageEngine.compare(
      ref('A', 'a.png'),
      ref('B', 'b.png'),
      imageEngine.defaultOptions(),
      ctx(host({ '/tmp/a.png': before, '/tmp/b.png': after })),
    );

    expect(result.data.sameSize).toBe(false);
    expect(result.data.compared).toEqual([100, 50]);
    // The padded half is transparent on one side and white on the other.
    expect(result.data.diffPixels).toBe(2500);
    expect(result.normalizationNotes.join(' ')).toContain('Dimensions differ');
    expect(result.summary.extra?.mismatch).toBe('size');
  });

  it('refuses to run without a decoder, and says where one exists', async () => {
    await expect(
      imageEngine.compare(
        ref('A', 'a.png'),
        ref('B', 'b.png'),
        imageEngine.defaultOptions(),
        ctx({}),
      ),
    ).rejects.toThrow(/app window/);
  });

  it('passes the host’s decode failure through, because the host owns the format list', async () => {
    // The engine used to name "PNG, JPEG, WebP, GIF and AVIF" itself, which made
    // v0.2.2's CLI — a PNG-only host — advertise four formats it cannot read.
    const broken = host({});
    await expect(
      imageEngine.compare(
        ref('A', 'a.png'),
        ref('B', 'b.png'),
        imageEngine.defaultOptions(),
        ctx(broken),
      ),
    ).rejects.toThrow(/no raster for/);
  });

  it('falls back to a generic message when the host explains nothing', async () => {
    const silent: ImageHost = {
      decode: () => Promise.reject(new Error('')),
      encodePng: () => Promise.resolve('data:,'),
    };
    await expect(
      imageEngine.compare(
        ref('A', 'a.png'),
        ref('B', 'b.png'),
        imageEngine.defaultOptions(),
        ctx({ ...host({}), image: silent }),
      ),
    ).rejects.toThrow(/could not be decoded/);
  });

  it('honours the abort signal', async () => {
    const controller = new AbortController();
    controller.abort();
    const raster = { ...canvas(10, 10), natural: [10, 10] as [number, number] };

    await expect(
      imageEngine.compare(ref('A', 'a.png'), ref('B', 'b.png'), imageEngine.defaultOptions(), {
        ...ctx(host({ '/tmp/a.png': raster, '/tmp/b.png': raster })),
        signal: controller.signal,
      }),
    ).rejects.toThrow(/cancelled/i);
  });
});
