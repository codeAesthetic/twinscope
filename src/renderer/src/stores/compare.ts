import { create } from 'zustand';
import { cancelImageJob, isRendererEngine, startImageJob } from '../lib/imageCompare';
import { useAppStore } from './app';
import { useHistoryStore } from './history';
import { defaultsFor } from './settings';
import { selectEngine } from '../../../engines/registry';
import type {
  CompareEvent,
  CompareRequest,
  HistoryRow,
  InputPayload,
  Summary,
} from '../../../shared/channels';

/**
 * State for the current comparison: the two inputs, the running job, and its
 * result or failure.
 *
 * One job at a time by design — TwinScope compares two things, and a second
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

/** Everything needed to restore a comparison the user drilled out of. */
interface ParentComparison {
  a: InputPayload | null;
  b: InputPayload | null;
  result: CompareResult | null;
  engineLabel: string | null;
  engineOverride: string | null;
  options: Record<string, unknown>;
  /** Breadcrumb text, e.g. `folder ↩`. */
  label: string;
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

  /**
   * The comparison to return to. Set when a folder diff drills into one of its
   * files: the parent result is kept whole so coming back is instant and does
   * not re-scan the tree (MD §15).
   */
  parent: ParentComparison | null;

  setInput: (side: 'A' | 'B', input: InputPayload | null) => void;
  setEngineOverride: (engineId: string | null) => void;
  /** Merges options into the current set and re-runs the comparison. */
  setOptions: (patch: Record<string, unknown>) => Promise<void>;
  /** Opens a nested comparison, remembering the current one. */
  drillInto: (a: InputPayload, b: InputPayload) => Promise<void>;
  /** Re-runs a stored comparison, re-reading both inputs from disk. */
  reopen: (row: HistoryRow) => Promise<void>;
  /** Returns to the remembered comparison without re-running it. */
  popDrill: () => void;
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

/**
 * Which engine this request will actually use. Main resolves it again for real;
 * the renderer needs to know first, because one engine runs here.
 */
function engineFor(request: CompareRequest): string {
  if (request.engineId !== undefined) return request.engineId;
  const asRef = (payload: InputPayload) => ({
    side: payload.side,
    kind: payload.kind,
    name: payload.name,
    size: payload.size,
  });
  return selectEngine(asRef(request.a), asRef(request.b))?.meta.id ?? '';
}

/**
 * Records a completed comparison. Deliberately fire-and-forget: a history write
 * that fails must never turn a successful comparison into a failed one.
 */
async function remember(state: CompareState, engineId: string, summary: Summary): Promise<void> {
  const { a, b, options, parent } = state;
  // A drill-in is a step *inside* a comparison, not a comparison the user chose
  // to run — recording it would bury the folder diff under its own files.
  if (a === null || b === null || parent !== null) return;

  try {
    await window.twinscope.history.record({ a, b, engineId, options, summary });
    await useHistoryStore.getState().refresh();
  } catch (cause) {
    console.warn('[history] could not record this comparison:', cause);
  }
}

export const useCompareStore = create<CompareState>((set, get) => ({
  a: null,
  b: null,
  engineOverride: null,
  options: {},
  parent: null,
  ...IDLE,

  setInput: (side, input) => {
    // Options belong to the pair that was loaded: a new input means a new
    // comparison, and possibly a different engine whose options are unrelated.
    set(
      side === 'A'
        ? { a: input, options: {}, parent: null, ...IDLE }
        : { b: input, options: {}, parent: null, ...IDLE },
    );
  },

  setOptions: async (patch) => {
    const options = { ...get().options, ...patch };
    set({ options });
    await get().run();
  },

  drillInto: async (a, b) => {
    const state = get();
    set({
      parent: {
        a: state.a,
        b: state.b,
        result: state.result,
        engineLabel: state.engineLabel,
        engineOverride: state.engineOverride,
        options: state.options,
        label: `${state.result?.engineId ?? 'parent'} ↩`,
      },
      a,
      b,
      // The nested pair is a different kind of thing: neither the parent's
      // engine choice nor its options mean anything here.
      engineOverride: null,
      options: {},
      ...IDLE,
    });
    await get().run();
  },

  reopen: async (row) => {
    const requests: Array<{ side: 'A' | 'B'; path: string }> = [];
    if (row.a.path !== undefined) requests.push({ side: 'A', path: row.a.path });
    if (row.b.path !== undefined) requests.push({ side: 'B', path: row.b.path });

    const resolved = await window.twinscope.input.resolve(requests);
    const a = row.a.path === undefined ? null : (resolved.shift() ?? null);
    const b = row.b.path === undefined ? null : (resolved.shift() ?? null);

    // A comparison is only as durable as its inputs. Two different failures, and
    // conflating them would be a lie: pasted text was never on disk, while a
    // file that has moved can be found again.
    const pasted = row.a.path === undefined || row.b.path === undefined;
    const missing = [a === null ? row.a.name : null, b === null ? row.b.name : null].filter(
      (name) => name !== null,
    );

    set({ a, b, engineOverride: row.engineId, options: row.options, parent: null, ...IDLE });

    if (missing.length > 0) {
      useAppStore
        .getState()
        .setNotice(
          pasted
            ? `${row.title} was pasted from the clipboard, so there is nothing to reopen. Paste it again with ⌘⇧V.`
            : `${missing.join(' and ')} could not be opened — it may have moved. Pick a replacement to compare again.`,
        );
      useAppStore.getState().setView('compare');
      return;
    }

    useAppStore.getState().setNotice(null);
    // Same as running from the Compare screen: move first, so the progress bar
    // is what the user sees rather than a frozen list.
    useAppStore.getState().setView('workspace');
    try {
      await get().run();
    } catch {
      // The store holds the failure; the workspace renders it.
    }
  },

  popDrill: () => {
    const { parent } = get();
    if (parent === null) return;
    set({
      ...IDLE,
      a: parent.a,
      b: parent.b,
      result: parent.result,
      engineLabel: parent.engineLabel,
      engineOverride: parent.engineOverride,
      options: parent.options,
      status: parent.result !== null ? 'done' : 'idle',
      percent: parent.result !== null ? 100 : 0,
      parent: null,
    });
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

  reset: () => set({ a: null, b: null, engineOverride: null, options: {}, parent: null, ...IDLE }),

  run: async (overrides) => {
    const { a, b, options, engineOverride } = get();
    if (!a || !b) throw new Error('Two inputs are needed to compare.');

    // IDLE clears the previous result; the options survive it because they
    // describe the request being made, not the reply.
    set({ ...IDLE, options, status: 'running' });

    const engineId = engineOverride ?? undefined;
    // The user's saved defaults seed the run; anything the engine view has
    // already changed for this pair still wins.
    const merged = { ...defaultsFor(engineId ?? engineFor({ a, b })), ...options };

    const request: CompareRequest = {
      a,
      b,
      ...(engineId !== undefined ? { engineId } : {}),
      ...(Object.keys(merged).length > 0 ? { options: merged } : {}),
      ...overrides,
    };

    try {
      // Almost every engine runs in the host process. The image engine cannot:
      // it needs a decoder, and the only one is in this window (D8).
      const started = isRendererEngine(engineFor(request))
        ? await startImageJob(request.a, request.b, request.options ?? {}, (event) =>
            get().applyEvent(event),
          )
        : await window.twinscope.compare.start(request);
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
    cancelImageJob(jobId);
    await window.twinscope.compare.cancel(jobId);
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
      void remember(get(), event.engineId, event.summary);
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
