import { create } from 'zustand';
import { nextMode } from '../lib/viewMode';

/**
 * The presentation each engine view is currently showing.
 *
 * Local state cannot hold this: changing a normalisation option re-runs the
 * engine, and `WorkspaceScreen` renders the result view only while the job is
 * `done`, so the view unmounts and remounts around every re-run. A view mode
 * that reset itself because the user toggled "ignore nulls" reads as a bug.
 *
 * Keyed by engine, so the text diff and the JSON diff remember their own choice
 * rather than fighting over one value. Session-scoped on purpose — persisting it
 * belongs with the per-engine defaults in `settings.json`, which is a decision
 * about preferences, not about this store.
 */
interface ViewModeState {
  byEngine: Readonly<Record<string, string>>;
  /** The chosen mode for an engine, or `fallback` when it has not chosen one. */
  modeFor(engineId: string, fallback: string): string;
  set(engineId: string, mode: string): void;
  /** `⌘\` — advance to the next mode in this engine's ring. */
  cycle(engineId: string, modes: readonly string[]): void;
}

export const useViewModeStore = create<ViewModeState>((set, get) => ({
  byEngine: {},

  modeFor: (engineId, fallback) => get().byEngine[engineId] ?? fallback,

  set: (engineId, mode) => {
    set((state) => ({ byEngine: { ...state.byEngine, [engineId]: mode } }));
  },

  cycle: (engineId, modes) => {
    set((state) => {
      const current = state.byEngine[engineId] ?? modes[0];
      return {
        byEngine: { ...state.byEngine, [engineId]: nextMode(modes, current as string) },
      };
    });
  },
}));
