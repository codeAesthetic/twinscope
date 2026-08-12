import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useChangeNavStore } from './changeNav';

const nav = () => useChangeNavStore.getState();

describe('change navigation', () => {
  beforeEach(() => {
    nav().clear();
  });

  it('does nothing until an engine view registers', () => {
    nav().next();
    expect(nav().current).toBe(-1);
    expect(nav().count).toBe(0);
  });

  it('starts unselected so the strip can show "– / n"', () => {
    nav().register(5, vi.fn());
    expect(nav().count).toBe(5);
    expect(nav().current).toBe(-1);
  });

  it('reveals each change as it steps forward', () => {
    const reveal = vi.fn();
    nav().register(3, reveal);

    nav().next();
    expect(nav().current).toBe(0);
    expect(reveal).toHaveBeenLastCalledWith(0);

    nav().next();
    expect(nav().current).toBe(1);
    expect(reveal).toHaveBeenLastCalledWith(1);
  });

  /** Wrapping is deliberate: scanning a diff should not dead-end. */
  it('wraps forward past the last change', () => {
    const reveal = vi.fn();
    nav().register(2, reveal);
    nav().goto(1);
    nav().next();
    expect(nav().current).toBe(0);
  });

  it('wraps backward past the first change', () => {
    nav().register(4, vi.fn());
    nav().goto(0);
    nav().previous();
    expect(nav().current).toBe(3);
  });

  it('stepping back from unselected lands on the last change', () => {
    nav().register(4, vi.fn());
    nav().previous();
    expect(nav().current).toBe(3);
  });

  it('clamps an out-of-range index instead of trusting it', () => {
    nav().register(3, vi.fn());
    nav().goto(99);
    expect(nav().current).toBe(0);
    nav().goto(-7);
    expect(nav().current).toBe(2);
  });

  /**
   * Registering happens on every result, so it has to reset the position —
   * otherwise change 7 of the previous comparison stays selected.
   */
  it('resets the position when a new view registers', () => {
    nav().register(10, vi.fn());
    nav().goto(6);
    expect(nav().current).toBe(6);

    nav().register(3, vi.fn());
    expect(nav().current).toBe(-1);
    expect(nav().count).toBe(3);
  });

  it('clear drops the reveal callback, so a stale view is never called', () => {
    const reveal = vi.fn();
    nav().register(3, reveal);
    nav().clear();
    nav().next();
    expect(reveal).not.toHaveBeenCalled();
  });
});
