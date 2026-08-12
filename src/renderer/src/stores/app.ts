import { create } from 'zustand';

/** The four top-level destinations (MD §10). */
export type View = 'compare' | 'history' | 'projects' | 'settings';

interface AppState {
  view: View;
  setView: (next: View) => void;
}

/**
 * No router (plan D11) — four screens switched by state. Deep linking can come
 * later if it earns its keep.
 */
export const useAppStore = create<AppState>((set) => ({
  view: 'compare',
  setView: (next) => set({ view: next }),
}));
