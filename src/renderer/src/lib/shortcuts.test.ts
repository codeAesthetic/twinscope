import { describe, expect, it } from 'vitest';
import { duplicateCombos, matches, parseCombo, SHORTCUTS, shortcutFor } from './shortcuts';

/** A KeyboardEvent-shaped object; the matcher only reads these four fields. */
function press(
  key: string,
  modifiers: { meta?: boolean; ctrl?: boolean; shift?: boolean; alt?: boolean } = {},
): KeyboardEvent {
  return {
    key,
    metaKey: modifiers.meta === true,
    ctrlKey: modifiers.ctrl === true,
    shiftKey: modifiers.shift === true,
    altKey: modifiers.alt === true,
  } as KeyboardEvent;
}

describe('parseCombo', () => {
  it('reads the modifiers a user sees in the label', () => {
    expect(parseCombo('⌘⇧E')).toEqual({ meta: true, shift: true, alt: false, key: 'e' });
    expect(parseCombo('⌥↓')).toEqual({ meta: false, shift: false, alt: true, key: 'arrowdown' });
    expect(parseCombo('Esc')).toEqual({ meta: false, shift: false, alt: false, key: 'escape' });
  });
});

describe('matches', () => {
  it('accepts ⌘ on macOS and Ctrl elsewhere from one table', () => {
    expect(matches(press('k', { meta: true }), '⌘K')).toBe(true);
    expect(matches(press('k', { ctrl: true }), '⌘K')).toBe(true);
  });

  it('ignores the case shift applies to the reported key', () => {
    expect(matches(press('E', { meta: true, shift: true }), '⌘⇧E')).toBe(true);
  });

  it('refuses a near miss rather than firing the wrong thing', () => {
    expect(matches(press('k', {}), '⌘K')).toBe(false);
    expect(matches(press('k', { meta: true, shift: true }), '⌘K')).toBe(false);
    expect(matches(press('e', { meta: true }), '⌘⇧E')).toBe(false);
  });

  it('handles the named keys', () => {
    expect(matches(press('ArrowDown', { alt: true }), '⌥↓')).toBe(true);
    expect(matches(press('Escape'), 'Esc')).toBe(true);
  });
});

describe('the registry', () => {
  it('binds no combo twice within a scope', () => {
    expect(duplicateCombos()).toEqual([]);
  });

  it('catches a clash when one is added', () => {
    expect(
      duplicateCombos([
        { id: 'one', combo: '⌘J', label: 'One', scope: 'workspace' },
        { id: 'two', combo: '⌘J', label: 'Two', scope: 'workspace' },
      ]),
    ).toEqual(['⌘J']);
  });

  it('treats a global binding as clashing with any scope', () => {
    expect(
      duplicateCombos([
        { id: 'one', combo: '⌘J', label: 'One', scope: 'global' },
        { id: 'two', combo: '⌘J', label: 'Two', scope: 'workspace' },
      ]),
    ).toEqual(['⌘J']);
  });

  it('gives every entry a unique id, since ids are how actions are dispatched', () => {
    const ids = SHORTCUTS.map((shortcut) => shortcut.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every palette entry an icon and a description', () => {
    for (const shortcut of SHORTCUTS.filter((entry) => entry.inPalette === true)) {
      expect(shortcut.icon, `${shortcut.id} needs an icon`).toBeDefined();
      expect(shortcut.detail, `${shortcut.id} needs a detail line`).toBeDefined();
    }
  });

  it('covers the bindings MD §10 names', () => {
    for (const id of [
      'palette',
      'open-files',
      'open-folders',
      'paste-compare',
      'export',
      'search',
    ]) {
      expect(shortcutFor(id), `${id} is missing`).toBeDefined();
    }
  });
});
