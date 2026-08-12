import { create } from 'zustand';

/**
 * The workspace search box, owned by the chassis rather than by each engine view.
 *
 * The box lives in the toolbar, but only the engine view knows what searching
 * means for its rows — so the frame owns the input and the query, and a view
 * opts in by calling `enable()` and reading `query`. A view that has not opted
 * in leaves the box visibly disabled instead of silently doing nothing.
 */
interface SearchState {
  query: string;
  enabled: boolean;
  placeholder: string;
  /** Bumped by ⌘F so the toolbar input can focus itself. */
  focusRequest: number;

  setQuery: (query: string) => void;
  enable: (placeholder: string) => void;
  disable: () => void;
  requestFocus: () => void;
}

export const useSearchStore = create<SearchState>((set, get) => ({
  query: '',
  enabled: false,
  placeholder: 'Search in diff…',
  focusRequest: 0,

  setQuery: (query) => set({ query }),
  enable: (placeholder) => set({ enabled: true, placeholder, query: '' }),
  disable: () => set({ enabled: false, query: '', placeholder: 'Search in diff…' }),
  requestFocus: () => set({ focusRequest: get().focusRequest + 1 }),
}));
