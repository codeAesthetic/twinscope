import { create } from 'zustand';
import type { UpdateState } from '../../../shared/channels';

/**
 * The update check's state, mirrored from main (v0.2.13).
 *
 * The store holds no policy: main decides whether a check may happen at all, and
 * this only ever reflects what it says. `dismissed` is the one piece of local
 * state, and it is deliberately **not** persisted — a notice you waved away is
 * dismissed for this session, and an update that is still missing next launch is
 * still worth mentioning once.
 */
interface UpdateStore {
  state: UpdateState;
  dismissed: boolean;

  /** Applies a state pushed by main. */
  apply: (next: UpdateState) => void;
  /** Reads the current state without checking. */
  load: () => Promise<void>;
  /** Checks now. Resolves to `off` without a request when the preference is off. */
  check: () => Promise<void>;
  open: () => Promise<void>;
  dismiss: () => void;
}

const INITIAL: UpdateState = { status: 'off', current: '0.0.0' };

export const useUpdateStore = create<UpdateStore>((set) => ({
  state: INITIAL,
  dismissed: false,

  // A newly announced update un-dismisses itself: the notice was waved away for
  // the version it was about, not for every version to come.
  apply: (next) =>
    set((previous) => ({
      state: next,
      dismissed: next.latest === previous.state.latest ? previous.dismissed : false,
    })),

  load: async () => {
    try {
      set({ state: await window.twinscope.update.read() });
    } catch {
      // A failed read is not worth a message: the row simply shows `off`.
    }
  },

  check: async () => {
    try {
      set({ state: await window.twinscope.update.check() });
    } catch {
      set((previous) => ({
        state: { ...previous.state, status: 'error', message: 'the update check failed' },
      }));
    }
  },

  open: () => window.twinscope.update.open(),

  dismiss: () => set({ dismissed: true }),
}));
