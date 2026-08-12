import { beforeEach, describe, expect, it } from 'vitest';
import { useViewModeStore } from './viewMode';

const MODES = ['side', 'unified', 'inline', 'tree', 'raw'] as const;

describe('useViewModeStore', () => {
  beforeEach(() => {
    useViewModeStore.setState({ byEngine: {} });
  });

  it('falls back until an engine has chosen', () => {
    expect(useViewModeStore.getState().modeFor('json', 'side')).toBe('side');
    useViewModeStore.getState().set('json', 'tree');
    expect(useViewModeStore.getState().modeFor('json', 'side')).toBe('tree');
  });

  it('keeps one choice per engine', () => {
    useViewModeStore.getState().set('json', 'raw');
    useViewModeStore.getState().set('text', 'unified');
    expect(useViewModeStore.getState().modeFor('json', 'side')).toBe('raw');
    expect(useViewModeStore.getState().modeFor('text', 'side')).toBe('unified');
  });

  it('cycles from the fallback and wraps', () => {
    const { cycle } = useViewModeStore.getState();
    cycle('json', MODES);
    expect(useViewModeStore.getState().modeFor('json', 'side')).toBe('unified');

    useViewModeStore.getState().set('json', 'raw');
    cycle('json', MODES);
    expect(useViewModeStore.getState().modeFor('json', 'side')).toBe('side');
  });

  it('survives what a re-run destroys — the whole reason it exists', () => {
    // The view unmounts around every engine re-run; the store is what the
    // remounted view reads back.
    useViewModeStore.getState().set('json', 'inline');
    expect(useViewModeStore.getState().modeFor('json', 'side')).toBe('inline');
  });
});
