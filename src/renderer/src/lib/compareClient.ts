import { useEffect, useState } from 'react';
import { useAppStore } from '../stores/app';
import { useCompareStore } from '../stores/compare';
import { SAMPLE_PAIR } from './mockData';

/**
 * Whether this is an unpackaged or test build, for gating dev-only affordances.
 *
 * Defaults to `false`, so a shipped build never flashes a development control
 * during the round trip — and a bridge that fails to answer hides them too.
 */
export function useIsDev(): boolean {
  const [isDev, setIsDev] = useState(false);

  useEffect(() => {
    let live = true;
    window.twinscope
      .ping()
      .then((result) => {
        if (live) setIsDev(result.isDev);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  return isDev;
}

/**
 * Bridges main's job events into the compare store.
 *
 * Subscribed once, at the app root: a per-component subscription would drop
 * events whenever the screen unmounted mid-comparison.
 */
export function useCompareEvents(): void {
  const applyEvent = useCompareStore((state) => state.applyEvent);

  useEffect(() => {
    return window.twinscope.compare.onEvent(applyEvent);
  }, [applyEvent]);
}

/**
 * Runs a comparison and moves the user to the workspace.
 *
 * Navigation happens immediately rather than on completion, so progress is
 * visible while the engine works (MD §30: feel instant even when it isn't).
 */
export function useRunComparison(): (engineId?: string) => Promise<void> {
  const run = useCompareStore((state) => state.run);
  const setView = useAppStore((state) => state.setView);

  return async (engineId) => {
    setView('workspace');
    try {
      await run(engineId !== undefined ? { engineId } : undefined);
    } catch {
      // The store already holds the failure; the workspace renders it.
    }
  };
}

/**
 * Fills both sides with the bundled sample and compares them for real.
 *
 * It goes through `setInput` like every other intake route, so what the user
 * lands on is the genuine text engine and the genuine diff view — not a
 * simulation of one. The button used to run the *demo engine*, which slept for
 * two seconds and printed "change 1 … change 11" over a footnote admitting no
 * comparison had happened; as a first impression of the product that was worse
 * than no button at all.
 */
export function useLoadSample(): () => Promise<void> {
  const setInput = useCompareStore((state) => state.setInput);
  const runComparison = useRunComparison();

  return async () => {
    const { before, after } = SAMPLE_PAIR;
    setInput('A', {
      side: 'A',
      kind: 'text',
      name: before.name,
      size: before.text.length,
      text: before.text,
    });
    setInput('B', {
      side: 'B',
      kind: 'text',
      name: after.name,
      size: after.text.length,
      text: after.text,
    });
    await runComparison();
  };
}

/**
 * Runs the demo engine — **development builds only** (`PingResult.isDev`).
 *
 * It reports progress and nothing else, which is what makes it the right way to
 * exercise the job pipeline: a real engine on inputs this small finishes before
 * a cancel button can be clicked, and one on inputs large enough to catch
 * mid-flight would make a permanent spec a race. It supplies its own inputs
 * because the pair is irrelevant to what it proves.
 */
export function useRunDemo(): () => Promise<void> {
  const setInput = useCompareStore((state) => state.setInput);
  const runComparison = useRunComparison();

  return async () => {
    setInput('A', { side: 'A', kind: 'text', name: 'demo-before.txt', size: 0, text: 'before' });
    setInput('B', { side: 'B', kind: 'text', name: 'demo-after.txt', size: 0, text: 'after' });
    await runComparison('demo');
  };
}
