import { create } from 'zustand';

/**
 * Change navigation, shared by the summary strip, the keyboard and each engine
 * view (MD §11: every comparison offers navigation between changes).
 *
 * The contract: an engine view registers how many changes it has and how to
 * reveal one. The chassis owns "which change am I on" so the strip, ⌥↑/⌥↓ and
 * the view can never disagree.
 */
interface ChangeNavState {
  /** Total navigable changes in the current result. */
  count: number;
  /** 0-based; -1 when nothing is selected yet. */
  current: number;
  /** Provided by the engine view. Scrolls/highlights the given change. */
  reveal: ((index: number) => void) | null;

  register: (count: number, reveal: (index: number) => void) => void;
  clear: () => void;
  goto: (index: number) => void;
  next: () => void;
  previous: () => void;
}

export const useChangeNavStore = create<ChangeNavState>((set, get) => ({
  count: 0,
  current: -1,
  reveal: null,

  register: (count, reveal) => set({ count, reveal, current: -1 }),

  clear: () => set({ count: 0, current: -1, reveal: null }),

  goto: (index) => {
    const { count, reveal } = get();
    if (count === 0) return;
    // Wraps deliberately: stepping past the last change returns to the first,
    // which is what a reviewer scanning a diff expects.
    const wrapped = ((index % count) + count) % count;
    set({ current: wrapped });
    reveal?.(wrapped);
  },

  next: () => get().goto(get().current + 1),
  previous: () => get().goto(get().current === -1 ? -1 : get().current - 1),
}));
