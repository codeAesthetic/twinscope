import { useEffect } from 'react';
import { useAppStore } from '../stores/app';
import { useCompareStore } from '../stores/compare';

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
  const setInput = useCompareStore((state) => state.setInput);
  const setView = useAppStore((state) => state.setView);

  return async (engineId) => {
    // The demo engine exists to exercise the pipeline, so it supplies its own
    // inputs rather than requiring the user to find two files first.
    if (engineId === 'demo') {
      setInput('A', { side: 'A', kind: 'text', name: 'demo-before.txt', size: 0, text: 'before' });
      setInput('B', { side: 'B', kind: 'text', name: 'demo-after.txt', size: 0, text: 'after' });
    }

    setView('workspace');
    try {
      await run(engineId !== undefined ? { engineId } : undefined);
    } catch {
      // The store already holds the failure; the workspace renders it.
    }
  };
}
