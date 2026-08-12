import { create } from 'zustand';

/**
 * The four sidebar destinations (MD §10), plus `workspace` — the comparison
 * chassis, which you reach by running a comparison rather than from the nav.
 */
export type View = 'compare' | 'workspace' | 'history' | 'projects' | 'settings';

interface AppState {
  view: View;
  /**
   * A one-line message pinned to the Compare screen — used when reopening a
   * comparison whose input has since moved or been deleted. It belongs to the
   * app rather than to the compare store because it outlives the failed run.
   */
  notice: string | null;
  setView: (next: View) => void;
  setNotice: (message: string | null) => void;
}

/**
 * No router (plan D11) — five screens switched by state. Deep linking can come
 * later if it earns its keep.
 */
export const useAppStore = create<AppState>((set) => ({
  view: 'compare',
  notice: null,
  setView: (next) => set({ view: next }),
  setNotice: (message) => set({ notice: message }),
}));
