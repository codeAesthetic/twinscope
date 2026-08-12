import { create } from 'zustand';

/**
 * The four sidebar destinations (MD §10), plus `workspace` — the comparison
 * chassis, which you reach by running a comparison rather than from the nav.
 */
export type View = 'compare' | 'workspace' | 'history' | 'projects' | 'settings';

interface AppState {
  view: View;
  setView: (next: View) => void;
}

/**
 * No router (plan D11) — five screens switched by state. Deep linking can come
 * later if it earns its keep.
 */
export const useAppStore = create<AppState>((set) => ({
  view: 'compare',
  setView: (next) => set({ view: next }),
}));
