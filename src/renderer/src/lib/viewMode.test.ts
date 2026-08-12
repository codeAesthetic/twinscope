import { describe, expect, it } from 'vitest';
import { nextMode } from './viewMode';
import { JSON_VIEW_MODES } from './jsonView';

describe('nextMode', () => {
  it('walks the ring and wraps at the end', () => {
    expect(nextMode(JSON_VIEW_MODES, 'side')).toBe('unified');
    expect(nextMode(JSON_VIEW_MODES, 'raw')).toBe('side');
  });

  it('cycles through every mode and returns to the start', () => {
    let mode = JSON_VIEW_MODES[0]!;
    const seen = [mode];
    for (let step = 1; step < JSON_VIEW_MODES.length; step += 1) {
      mode = nextMode(JSON_VIEW_MODES, mode);
      seen.push(mode);
    }
    expect(seen).toEqual([...JSON_VIEW_MODES]);
    expect(nextMode(JSON_VIEW_MODES, mode)).toBe(JSON_VIEW_MODES[0]);
  });

  it('starts from the first mode when the current one is not in the ring', () => {
    // Defensive: a persisted mode from an older build must not wedge the cycle.
    expect(nextMode(['a', 'b'] as const, 'gone' as 'a')).toBe('a');
  });

  it('leaves a single-mode ring alone', () => {
    expect(nextMode(['only'] as const, 'only')).toBe('only');
    expect(nextMode([] as const, 'x' as never)).toBe('x');
  });
});
