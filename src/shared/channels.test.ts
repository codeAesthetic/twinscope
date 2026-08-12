import { describe, expect, it } from 'vitest';
import { IPC } from './channels';

describe('IPC channels', () => {
  it('namespaces every channel, so main can route by prefix', () => {
    for (const channel of Object.values(IPC)) {
      expect(channel).toMatch(/^[a-z]+:[a-zA-Z]+$/);
    }
  });

  it('has no duplicate channel names', () => {
    const names = Object.values(IPC);
    expect(new Set(names).size).toBe(names.length);
  });
});
