import { create } from 'zustand';
import { useSettingsStore } from './settings';
import type { Project, SavedComparison } from '../../../shared/channels';

/**
 * Projects and saved comparisons (v0.2.9), mirrored from the database in main.
 *
 * The active project is deliberately **not** state here — it lives in preferences
 * (`activeProjectId`), because which project you are working in has to survive a
 * restart.
 *
 * This store knows nothing about the *current comparison*: everything that touches
 * it (saving one, opening one, capturing a preset) is in `lib/savedComparisons.ts`.
 * Stores here point one way — the compare store reads history and settings, never
 * the reverse — and importing the compare store from a store it imports would be a
 * cycle that only shows up as an undefined at module-init time.
 */
interface ProjectsState {
  projects: Project[];
  saved: SavedComparison[];
  loaded: boolean;
  /**
   * The comparison just saved, for the workspace's confirmation (v0.2.9).
   *
   * Store state rather than the screen's own, because ⌘S and the toolbar button go
   * through the same function and have to produce the same feedback — the first
   * version kept it local to the button's `onClick`, so the keyboard path saved
   * silently and the two ways in stopped behaving alike.
   */
  lastSaved: SavedComparison | null;

  refresh: () => Promise<void>;
  /** Reloads only the saved list — the projects have not changed. */
  refreshSaved: () => Promise<void>;
  save: (patch: {
    id?: number;
    name: string;
    root?: string;
    presets?: Record<string, Record<string, unknown>>;
    ignores?: string[];
  }) => Promise<Project>;
  remove: (id: number) => Promise<void>;
  setActive: (id: number | null) => Promise<void>;
  /** Deletes one saved comparison. The project it was in is untouched. */
  removeSaved: (id: number) => Promise<void>;
  clearLastSaved: () => void;
}

export const useProjectsStore = create<ProjectsState>((set, get) => ({
  projects: [],
  saved: [],
  loaded: false,
  lastSaved: null,

  refreshSaved: async () => {
    set({ saved: await window.twinscope.saved.list() });
  },

  refresh: async () => {
    const [projects, saved] = await Promise.all([
      window.twinscope.projects.list(),
      window.twinscope.saved.list(),
    ]);
    set({ projects, saved, loaded: true });
  },

  save: async (patch) => {
    const project = await window.twinscope.projects.save(patch);
    await get().refresh();
    return project;
  },

  remove: async (id) => {
    await window.twinscope.projects.remove(id);
    // The project is gone but its comparisons are not, so both lists change.
    if (useSettingsStore.getState().preferences.activeProjectId === id) {
      await useSettingsStore.getState().update({ activeProjectId: null });
    }
    await get().refresh();
  },

  setActive: async (id) => {
    await useSettingsStore.getState().update({ activeProjectId: id });
  },

  removeSaved: async (id) => {
    await window.twinscope.saved.remove(id);
    await get().refreshSaved();
  },

  clearLastSaved: () => set({ lastSaved: null }),
}));

export function activeProjectId(): number | null {
  return useSettingsStore.getState().preferences.activeProjectId ?? null;
}

/** The active project, or null. Shared by the screens that badge it. */
export function activeProject(): Project | null {
  const id = activeProjectId();
  if (id === null) return null;
  return useProjectsStore.getState().projects.find((project) => project.id === id) ?? null;
}
