import { describe, expect, it } from 'vitest';
import {
  deltaScore,
  radarFrom,
  RADAR_AXES,
  RADAR_LABELS,
  RADAR_MEANING,
  ratioScore,
} from './radar';
import { textEngine } from './text';
import { imageEngine } from './image';
import { depsEngine } from './deps';
import type { EngineCtx, InputRef, Raster } from './types';

describe('ratioScore', () => {
  it('is 0 for nothing and 100 for everything', () => {
    expect(ratioScore(0, 100)).toBe(0);
    expect(ratioScore(100, 100)).toBe(100);
  });

  it('lifts a small real change into visibility', () => {
    // Two lines in four thousand is 0.05% — linear, it draws as literally nothing,
    // and yet "a couple of lines changed" is what the reader wants to see.
    expect(ratioScore(2, 4000)).toBeGreaterThan(1);
    expect(ratioScore(2, 4000)).toBeLessThan(10);
  });

  it('is monotonic, so a bigger change never scores lower', () => {
    let previous = -1;
    for (const part of [0, 1, 5, 25, 50, 90, 100]) {
      const score = ratioScore(part, 100);
      expect(score).toBeGreaterThanOrEqual(previous);
      previous = score;
    }
  });

  it('never divides by zero or exceeds the rim', () => {
    expect(ratioScore(5, 0)).toBe(0);
    expect(ratioScore(500, 100)).toBe(100);
    expect(ratioScore(-5, 100)).toBe(0);
  });
});

describe('deltaScore', () => {
  it('treats growth and shrinkage as equally large', () => {
    expect(deltaScore(100, 200)).toBe(deltaScore(200, 100));
  });

  it('is 0 when nothing moved, and 0 when there is nothing to move', () => {
    expect(deltaScore(100, 100)).toBe(0);
    expect(deltaScore(0, 0)).toBe(0);
  });

  it('scores appearing from nothing as total', () => {
    expect(deltaScore(0, 500)).toBe(100);
  });
});

describe('radarFrom', () => {
  it('omits an axis it was given no number for', () => {
    // The crux of the feature: absent means "cannot measure", which is not zero.
    const scores = radarFrom({ structure: 40 });
    expect(scores).toEqual({ structure: 40 });
    expect('content' in scores).toBe(false);
  });

  it('drops NaN rather than plotting it', () => {
    expect(radarFrom({ structure: Number.NaN })).toEqual({});
  });

  it('clamps and rounds', () => {
    expect(radarFrom({ structure: 140, content: -10, visual: 42.6 })).toEqual({
      structure: 100,
      content: 0,
      visual: 43,
    });
  });

  it('ignores keys that are not axes', () => {
    expect(radarFrom({ nonsense: 50 } as Record<string, number>)).toEqual({});
  });
});

describe('the axis vocabulary', () => {
  it('labels and explains every axis', () => {
    // An axis without a stated meaning is where a dishonest number gets in — MD §21
    // names "Performance" without defining it, which is why this is asserted.
    for (const axis of RADAR_AXES) {
      expect(RADAR_LABELS[axis], axis).toBeTruthy();
      expect(RADAR_MEANING[axis], axis).toBeTruthy();
    }
    expect(RADAR_AXES).toHaveLength(6);
  });
});

describe('engines score only what they can measure', () => {
  const ctx = (extras: Partial<EngineCtx> = {}): EngineCtx => ({
    signal: new AbortController().signal,
    progress: () => undefined,
    ...extras,
  });

  it('the text engine reports structure and content, and nothing else', async () => {
    const result = await textEngine.compare(
      // The middle line has to be similar enough to *pair* as a modification, or
      // the engine reports two unrelated rows and Content stays at zero.
      { side: 'A', kind: 'text', name: 'a.txt', size: 0, text: 'one\nvalue = 1\nthree\n' },
      { side: 'B', kind: 'text', name: 'b.txt', size: 0, text: 'one\nvalue = 2\nthree\nfour\n' },
      textEngine.defaultOptions(),
      ctx(),
    );

    const radar = result.summary.radar ?? {};
    expect(radar.structure).toBeGreaterThan(0);
    expect(radar.content).toBeGreaterThan(0);
    // A line diff has nothing to say about pixels, licences or weight.
    expect(radar.visual).toBeUndefined();
    expect(radar.dependencies).toBeUndefined();
    expect(radar.performance).toBeUndefined();
  });

  it('the image engine reports the visual axis, which nothing else can', async () => {
    const raster = (colour: number): Raster & { natural: [number, number] } => ({
      width: 2,
      height: 2,
      data: new Uint8ClampedArray([
        colour,
        0,
        0,
        255,
        colour,
        0,
        0,
        255,
        colour,
        0,
        0,
        255,
        colour,
        0,
        0,
        255,
      ]),
      natural: [2, 2],
    });

    const result = await imageEngine.compare(
      { side: 'A', kind: 'image', name: 'a.png', path: '/a.png', size: 1 },
      { side: 'B', kind: 'image', name: 'b.png', path: '/b.png', size: 1 },
      imageEngine.defaultOptions(),
      ctx({
        fs: {
          readBytes: (path) => Promise.resolve(new TextEncoder().encode(path)),
          readText: () => Promise.reject(new Error('no')),
          listDir: () => Promise.reject(new Error('no')),
          stat: () => Promise.reject(new Error('no')),
          hashFile: () => Promise.reject(new Error('no')),
        },
        image: {
          decode: (bytes) =>
            Promise.resolve(raster(new TextDecoder().decode(bytes) === '/a.png' ? 255 : 0)),
          encodePng: () => Promise.resolve('data:,'),
        },
      }),
    );

    const radar = result.summary.radar ?? {};
    expect(radar.visual).toBe(100);
    // Same dimensions, so the shape did not change and the weight did not move.
    expect(radar.structure).toBe(0);
    expect(radar.performance).toBe(0);
    expect(radar.content).toBeUndefined();
    expect(radar.metadata).toBeUndefined();
  });

  it('the deps engine fills the axis the radar was waiting for', async () => {
    const result = await depsEngine.compare(
      {
        side: 'A',
        kind: 'deps',
        name: 'package.json',
        size: 0,
        text: JSON.stringify({ dependencies: { a: '1.0.0', b: '1.0.0' } }),
      },
      {
        side: 'B',
        kind: 'deps',
        name: 'package.json',
        size: 0,
        text: JSON.stringify({ dependencies: { a: '2.0.0', c: '1.0.0' } }),
      },
      depsEngine.defaultOptions(),
      ctx(),
    );

    const radar = result.summary.radar ?? {};
    expect(radar.dependencies).toBeGreaterThan(0);
    // A manifest pair resolves nothing, so licences and weight are unknown — not zero.
    expect(radar.metadata).toBeUndefined();
    expect(radar.performance).toBeUndefined();
  });

  it('gives a comparison with no differences a shape at the centre', async () => {
    const same: InputRef = { side: 'A', kind: 'text', name: 'a.txt', size: 0, text: 'x\ny\n' };
    const result = await textEngine.compare(
      same,
      { ...same, side: 'B', name: 'b.txt' },
      textEngine.defaultOptions(),
      ctx(),
    );
    // Identical inputs short-circuit before the diff, so there is no radar at all
    // rather than a ring of zeroes claiming six measurements were taken.
    expect(result.summary.radar).toBeUndefined();
  });
});
