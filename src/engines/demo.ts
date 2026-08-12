import type { DiffEngine, DiffResult } from './types';

export interface DemoOptions {
  /** How many progress steps to emit. */
  steps: number;
  /** Milliseconds per step. */
  stepMs: number;
}

export interface DemoData {
  steps: number;
  note: string;
}

/**
 * A deliberately slow engine that only reports progress.
 *
 * It exists so the whole pipeline — renderer → main → engine host → back — can
 * be exercised and cancelled before any real engine is written (MVP-1's
 * acceptance). `canHandle` always returns false, so detection never picks it;
 * it runs only when named explicitly by `engineId`.
 *
 * Delete when the real engines land and MVP-11 does its polish pass.
 */
export const demoEngine: DiffEngine<DemoOptions, DemoData> = {
  meta: { id: 'demo', label: 'Demo (pipeline test)', priority: -1 },

  canHandle: () => false,

  // ~2s: long enough to watch progress move and to cancel mid-run, short
  // enough that the regression suite stays fast.
  defaultOptions: () => ({ steps: 20, stepMs: 100 }),

  async compare(a, b, options, ctx): Promise<DiffResult<DemoData>> {
    const startedAt = Date.now();
    const steps = Math.max(1, Math.min(200, options.steps));
    const stepMs = Math.max(0, Math.min(2000, options.stepMs));

    for (let step = 1; step <= steps; step++) {
      // Cancellation is cooperative: engines must check between units of work,
      // and the host aborts the signal rather than killing the process.
      if (ctx.signal.aborted) throw new DOMException('Comparison cancelled', 'AbortError');

      await sleep(stepMs, ctx.signal);
      ctx.progress(Math.round((step / steps) * 100), `step ${step} of ${steps}`);
    }

    return {
      engineId: 'demo',
      summary: { added: 3, removed: 1, modified: 7 },
      data: { steps, note: `compared ${a.name} against ${b.name}` },
      normalizationNotes: ['Demo engine — no real comparison was performed.'],
      timings: { ms: Date.now() - startedAt },
    };
  },
};

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    function onAbort(): void {
      clearTimeout(timer);
      reject(new DOMException('Comparison cancelled', 'AbortError'));
    }

    signal.addEventListener('abort', onAbort, { once: true });
  });
}
