import { create } from 'zustand';
import type { CompareEvent, CompareRequest, InputPayload, Summary } from '../../../shared/channels';

/**
 * State for the current comparison: the two inputs, the running job, and its
 * result or failure.
 *
 * One job at a time by design — DevDiff compares two things, and a second
 * request supersedes the first (MD §11). Batch comparison is explicitly out of
 * MVP scope.
 */

export type JobStatus = 'idle' | 'running' | 'done' | 'error';

export interface CompareResult {
  engineId: string;
  summary: Summary;
  data: unknown;
  normalizationNotes: string[];
  ms: number;
}

interface CompareState {
  a: InputPayload | null;
  b: InputPayload | null;

  status: JobStatus;
  jobId: string | null;
  engineLabel: string | null;
  percent: number;
  progressMessage: string | null;

  result: CompareResult | null;
  error: {
    message: string;
    reason: 'failed' | 'cancelled' | 'crash';
    fallback?: { engineId: string; label: string };
  } | null;

  /** Manual engine choice. Detection still decides when this is null (Rule 1). */
  engineOverride: string | null;

  /**
   * Engine options for the current pair. Engine views change these and the job
   * re-runs — normalisation is a property of the comparison, not of the view, so
   * the counts have to come back from the engine (Rule 3).
   */
  options: Record<string, unknown>;

  setInput: (side: 'A' | 'B', input: InputPayload | null) => void;
  setEngineOverride: (engineId: string | null) => void;
  /** Merges options into the current set and re-runs the comparison. */
  setOptions: (patch: Record<string, unknown>) => Promise<void>;
  swap: () => void;
  reset: () => void;

  /** Starts a job and returns its id, or throws with a user-safe message. */
  run: (request?: Partial<CompareRequest>) => Promise<string>;
  cancel: () => Promise<void>;
  /** Applies one event from main. Ignores events for superseded jobs. */
  applyEvent: (event: CompareEvent) => void;
}

const IDLE = {
  status: 'idle' as JobStatus,
  jobId: null,
  engineLabel: null,
  percent: 0,
  progressMessage: null,
  result: null,
  error: null,
};

export const useCompareStore = create<CompareState>((set, get) => ({
  a: null,
  b: null,
  engineOverride: null,
  options: {},
  ...IDLE,

  setInput: (side, input) => {
    // Options belong to the pair that was loaded: a new input means a new
    // comparison, and possibly a different engine whose options are unrelated.
    set(side === 'A' ? { a: input, options: {}, ...IDLE } : { b: input, options: {}, ...IDLE });
  },

  setOptions: async (patch) => {
    const options = { ...get().options, ...patch };
    set({ options });
    await get().run();
  },

  swap: () => {
    const { a, b } = get();
    set({
      a: b ? { ...b, side: 'A' } : null,
      b: a ? { ...a, side: 'B' } : null,
      options: {},
      ...IDLE,
    });
  },

  setEngineOverride: (engineId) => set({ engineOverride: engineId, options: {}, ...IDLE }),

  reset: () => set({ a: null, b: null, engineOverride: null, options: {}, ...IDLE }),

  run: async (overrides) => {
    const { a, b, options, engineOverride } = get();
    if (!a || !b) throw new Error('Two inputs are needed to compare.');

    // IDLE clears the previous result; the options survive it because they
    // describe the request being made, not the reply.
    set({ ...IDLE, options, status: 'running' });

    try {
      const started = await window.devdiff.compare.start({
        a,
        b,
        ...(engineOverride !== null ? { engineId: engineOverride } : {}),
        ...(Object.keys(options).length > 0 ? { options } : {}),
        ...overrides,
      });
      set({ jobId: started.jobId, engineLabel: started.engineLabel });
      return started.jobId;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      set({ status: 'error', error: { message, reason: 'failed' } });
      throw cause;
    }
  },

  cancel: async () => {
    const { jobId } = get();
    if (jobId === null) return;
    await window.devdiff.compare.cancel(jobId);
  },

  applyEvent: (event) => {
    // A late event from a job the user already replaced must not clobber the
    // current one.
    if (event.jobId !== get().jobId) return;

    if (event.type === 'progress') {
      set({ percent: event.percent, progressMessage: event.message ?? null });
      return;
    }

    if (event.type === 'done') {
      set({
        status: 'done',
        percent: 100,
        progressMessage: null,
        result: {
          engineId: event.engineId,
          summary: event.summary,
          data: event.data,
          normalizationNotes: event.normalizationNotes,
          ms: event.ms,
        },
      });
      return;
    }

    set({
      status: 'error',
      progressMessage: null,
      error: {
        message: event.message,
        reason: event.reason,
        ...(event.fallback !== undefined ? { fallback: event.fallback } : {}),
      },
    });
  },
}));
