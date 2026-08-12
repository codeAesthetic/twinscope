import { describe, expect, it } from 'vitest';
import {
  CAPTION_BLOCK,
  clampZoom,
  fitZoom,
  isFitZoom,
  minZoom,
  PANE_GAP,
  scrollForZoom,
  stepZoom,
  STAGE_PADDING,
  ZOOM_MAX,
  zoomPercent,
  zoomStops,
} from './imageZoom';

/** The stage on a 1440px window: 1440 − 214 sidebar − 250 right rail. */
const STAGE = { width: 976, height: 700 };

describe('fitZoom', () => {
  it('fits both panes of a large pair, which 25% could not', () => {
    const fit = fitZoom(STAGE, [4000, 3000], 2);

    // Two panes plus the gap have to end up inside the padded stage.
    const used = fit * 4000 * 2 + PANE_GAP;
    expect(used).toBeLessThanOrEqual(STAGE.width - STAGE_PADDING * 2);
    expect(fit * 3000).toBeLessThanOrEqual(STAGE.height - STAGE_PADDING * 2 - CAPTION_BLOCK);

    // The old floor was 0.25 — this pair needs roughly a tenth of that room.
    expect(fit).toBeLessThan(0.25);
  });

  it('gives a single pane more room than two', () => {
    const side = fitZoom(STAGE, [4000, 1200], 2);
    const single = fitZoom(STAGE, [4000, 1200], 1);
    expect(single).toBeGreaterThan(side);
  });

  it('binds on height for a tall image', () => {
    const fit = fitZoom({ width: 4000, height: 500 }, [1000, 4000], 1);
    expect(fit * 4000).toBeLessThanOrEqual(500 - STAGE_PADDING * 2 - CAPTION_BLOCK);
  });

  it('never magnifies a small image', () => {
    expect(fitZoom(STAGE, [16, 16], 2)).toBe(1);
  });

  it('survives an unmeasured or collapsed stage', () => {
    expect(fitZoom({ width: 0, height: 0 }, [4000, 3000], 2)).toBeGreaterThan(0);
    expect(fitZoom(STAGE, [0, 0], 2)).toBe(1);
  });
});

describe('minZoom', () => {
  it('drops below the lowest fixed stop when a fit needs it', () => {
    const fit = fitZoom(STAGE, [20000, 15000], 2);
    expect(fit).toBeLessThan(0.05);
    expect(minZoom(fit)).toBe(fit);
  });

  it('keeps the lowest fixed stop when fit is higher', () => {
    expect(minZoom(0.5)).toBe(0.05);
  });
});

describe('zoomStops', () => {
  it('splices fit into the ladder in order', () => {
    const stops = zoomStops(0.115);
    expect(stops).toContain(0.115);
    expect([...stops]).toEqual([...stops].sort((a, b) => a - b));
  });

  it('does not duplicate a fit that is already a stop', () => {
    expect(zoomStops(0.5).filter((stop) => stop === 0.5)).toHaveLength(1);
  });
});

describe('stepZoom', () => {
  it('walks the ladder rather than multiplying', () => {
    expect(stepZoom(1, 1, 0.5)).toBe(1.5);
    expect(stepZoom(1, -1, 0.5)).toBe(0.66);
  });

  it('steps out of a fitted view onto fit itself', () => {
    const fit = 0.115;
    const zoomedIn = stepZoom(fit, 1, fit);
    expect(zoomedIn).toBeGreaterThan(fit);
    expect(stepZoom(zoomedIn, -1, fit)).toBe(fit);
  });

  it('stops at the ends instead of running off them', () => {
    expect(stepZoom(ZOOM_MAX, 1, 0.5)).toBe(ZOOM_MAX);
    const fit = 0.02;
    expect(stepZoom(fit, -1, fit)).toBe(fit);
  });
});

describe('clampZoom', () => {
  it('bounds a continuous gesture by the same floor as the ladder', () => {
    // Fit above the lowest stop: zooming out past fit to 5% is still allowed.
    expect(clampZoom(0.001, 0.115)).toBe(0.05);
    expect(clampZoom(99, 0.115)).toBe(ZOOM_MAX);
    expect(clampZoom(0.3, 0.115)).toBe(0.3);
  });

  it('lets a gesture reach a fit that is below every fixed stop', () => {
    const fit = fitZoom(STAGE, [20000, 15000], 2);
    expect(clampZoom(0.001, fit)).toBe(fit);
  });
});

describe('isFitZoom', () => {
  it('tolerates the float error a fit computation carries', () => {
    const fit = fitZoom(STAGE, [4000, 3000], 2);
    expect(isFitZoom(fit + 1e-9, fit)).toBe(true);
    expect(isFitZoom(fit * 1.5, fit)).toBe(false);
  });
});

describe('zoomPercent', () => {
  it('never reads as 0%', () => {
    expect(zoomPercent(0.004)).toBe(1);
    expect(zoomPercent(0.115)).toBe(12);
  });
});

describe('scrollForZoom', () => {
  const box = { scrollLeft: 100, scrollTop: 50, clientWidth: 900, clientHeight: 600 };

  it('keeps the centre of the view under the centre of the view', () => {
    // The point 550px into the content is at the middle of the viewport; after
    // doubling it sits at 1100, so the scroll has to move by 550 − not by 450.
    const next = scrollForZoom(box, 1, 2);
    expect(next.left).toBe((100 + 450) * 2 - 450);
    expect(next.top).toBe((50 + 300) * 2 - 300);
  });

  it('keeps the pointer over the same pixel', () => {
    const next = scrollForZoom(box, 1, 2, { x: 0, y: 0 });
    expect(next.left).toBe(200);
    expect(next.top).toBe(100);
  });

  it('does not scroll to a negative offset when zooming out', () => {
    const next = scrollForZoom(box, 4, 0.1, { x: 10, y: 10 });
    expect(next.left).toBeGreaterThanOrEqual(0);
    expect(next.top).toBeGreaterThanOrEqual(0);
  });

  it('is inert before the first measurement', () => {
    expect(scrollForZoom(box, 0, 2)).toEqual({ left: 100, top: 50 });
  });
});
