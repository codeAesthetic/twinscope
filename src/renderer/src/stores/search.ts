import { create } from 'zustand';

/**
 * The workspace search box, owned by the chassis rather than by each engine view.
 *
 * The box lives in the toolbar, but only the engine view knows what searching
 * means for its rows — so the frame owns the input and the query, and a view
 * opts in by calling `enable()` and reading `query`. A view that has not opted
 * in leaves the box visibly disabled instead of silently doing nothing.
 *
 * Views use it two ways, and both are legitimate:
 *  - **as a filter** (JSON, folder): non-matching rows disappear; no match
 *    registration, so no `n/m` badge.
 *  - **as a find** (text): every row stays, matches are highlighted, and ⏎
 *    steps through them. Such a view calls `registerMatches`, which mirrors the
 *    change-nav contract exactly — the store owns *which match is current* so
 *    the badge, ⏎/⇧⏎ and the view can never disagree.
 */
interface SearchState {
  query: string;
  enabled: boolean;
  placeholder: string;
  /** Bumped by ⌘F so the toolbar input can focus itself. */
  focusRequest: number;

  /** Total matches in the current result; 0 when the view filters instead. */
  matches: number;
  /** 0-based; -1 when nothing is selected yet. */
  current: number;
  /** Provided by the engine view. Scrolls the given match into view. */
  reveal: ((index: number) => void) | null;

  setQuery: (query: string) => void;
  enable: (placeholder: string) => void;
  disable: () => void;
  requestFocus: () => void;

  registerMatches: (count: number, reveal: (index: number) => void) => void;
  clearMatches: () => void;
  goto: (index: number) => void;
  next: () => void;
  previous: () => void;
}

const NO_MATCHES = { matches: 0, current: -1, reveal: null };

export const useSearchStore = create<SearchState>((set, get) => ({
  query: '',
  enabled: false,
  placeholder: 'Search in diff…',
  focusRequest: 0,
  ...NO_MATCHES,

  // Typing restarts the walk: the old index means nothing against a new query.
  setQuery: (query) => set({ query, current: -1 }),

  enable: (placeholder) => set({ enabled: true, placeholder, query: '', ...NO_MATCHES }),
  disable: () => set({ enabled: false, query: '', placeholder: 'Search in diff…', ...NO_MATCHES }),
  requestFocus: () => set({ focusRequest: get().focusRequest + 1 }),

  registerMatches: (matches, reveal) => {
    // Keep the current match when the count is unchanged — a re-render must not
    // throw the user back to the first hit mid-walk.
    const keep = get().matches === matches ? get().current : -1;
    set({ matches, reveal, current: keep });
  },

  clearMatches: () => set(NO_MATCHES),

  goto: (index) => {
    const { matches, reveal } = get();
    if (matches === 0) return;
    // Wraps, like change navigation: past the last match is the first again.
    const wrapped = ((index % matches) + matches) % matches;
    set({ current: wrapped });
    reveal?.(wrapped);
  },

  next: () => get().goto(get().current + 1),
  previous: () => get().goto(get().current === -1 ? -1 : get().current - 1),
}));
