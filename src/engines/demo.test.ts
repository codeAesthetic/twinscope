import { describe, expect, it } from 'vitest';
import { demoEngine } from './demo';
import { engineById, selectEngine } from './registry';
import type { EngineCtx, InputRef } from './types';

const ref = (side: 'A' | 'B'): InputRef => ({ side, kind: 'text', name: `${side}.txt`, size: 0 });

function ctx(signal: AbortSignal): { ctx: EngineCtx; progress: number[] } {
  const progress: number[] = [];
  return {
    ctx: { signal, progress: (percent) => progress.push(percent) },
    progress,
  };
}

describe('demo engine', () => {
  it('reports monotonic progress and finishes at 100', async () => {
    const { ctx: engineCtx, progress } = ctx(new AbortController().signal);

    const result = await demoEngine.compare(ref('A'), ref('B'), { steps: 4, stepMs: 0 }, engineCtx);

    expect(progress).toEqual([25, 50, 75, 100]);
    expect(result.engineId).toBe('demo');
    expect(result.summary).toEqual({ added: 3, removed: 1, modified: 7 });
    expect(result.normalizationNotes[0]).toMatch(/no real comparison/i);
  });

  it('names both inputs in its result, proving they arrived', async () => {
    const { ctx: engineCtx } = ctx(new AbortController().signal);
    const result = await demoEngine.compare(ref('A'), ref('B'), { steps: 1, stepMs: 0 }, engineCtx);
    expect(result.data.note).toBe('compared A.txt against B.txt');
  });

  /**
   * The cancellation contract: engines must reject with an AbortError once the
   * signal fires. The host relies on this instead of killing the process, so an
   * engine that ignores it leaks work.
   */
  it('rejects with AbortError when cancelled mid-run', async () => {
    const controller = new AbortController();
    const { ctx: engineCtx, progress } = ctx(controller.signal);

    const running = demoEngine.compare(ref('A'), ref('B'), { steps: 50, stepMs: 5 }, engineCtx);
    setTimeout(() => controller.abort(), 15);

    await expect(running).rejects.toMatchObject({ name: 'AbortError' });
    // It stopped early rather than running to completion.
    expect(progress.length).toBeLessThan(50);
  });

  it('rejects immediately when handed an already-aborted signal', async () => {
    const controller = new AbortController();
    controller.abort();
    const { ctx: engineCtx, progress } = ctx(controller.signal);

    await expect(
      demoEngine.compare(ref('A'), ref('B'), { steps: 10, stepMs: 0 }, engineCtx),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(progress).toEqual([]);
  });

  it('clamps absurd options rather than hanging', async () => {
    const { ctx: engineCtx, progress } = ctx(new AbortController().signal);
    await demoEngine.compare(ref('A'), ref('B'), { steps: -5, stepMs: -1 }, engineCtx);
    expect(progress).toEqual([100]);
  });
});

describe('registry with the demo engine present', () => {
  it('is reachable by id but never chosen by detection', () => {
    expect(engineById('demo')?.meta.id).toBe('demo');
    expect(selectEngine(ref('A'), ref('B'))?.meta.id).toBe('text');
  });

  it('does not shadow a real engine on priority', () => {
    expect(demoEngine.meta.priority).toBeLessThan(0);
  });
});
