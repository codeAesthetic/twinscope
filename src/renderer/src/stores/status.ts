import { create } from 'zustand';

/**
 * The status bar's contents, set by whichever screen is showing.
 *
 * The bar lives in `AppFrame`, above the screens, so a screen cannot render into
 * it directly. A tiny store is cheaper than threading a render prop through the
 * frame, and it keeps the privacy claim on the left untouched.
 */
interface StatusState {
  /** Replaces the engine list in the middle. Null restores the default. */
  detail: string | null;
  /** Replaces the right-hand slot. Null restores the bridge status. */
  right: string | null;
  set: (next: { detail?: string | null; right?: string | null }) => void;
  clear: () => void;
}

export const useStatusStore = create<StatusState>((set) => ({
  detail: null,
  right: null,
  set: ({ detail, right }) =>
    set((state) => ({
      detail: detail === undefined ? state.detail : detail,
      right: right === undefined ? state.right : right,
    })),
  clear: () => set({ detail: null, right: null }),
}));
