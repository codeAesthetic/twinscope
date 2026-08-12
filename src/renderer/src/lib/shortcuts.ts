/**
 * The keyboard map (MD §10/§33), declared once.
 *
 * One table drives three things that used to drift apart: what actually fires,
 * what the Settings screen lists, and what the command palette offers. A binding
 * that is not in here does not exist.
 *
 * Combos are written the way a user reads them (`⌘⇧E`) and matched by parsing
 * that same string, so the label and the behaviour cannot disagree.
 */

export type Scope = 'global' | 'home' | 'workspace';

export interface Shortcut {
  id: string;
  combo: string;
  /**
   * Equivalent bindings that also fire this action. Declared rather than left
   * implicit so the Settings grid shows every key that works, and so the
   * duplicate check covers them too.
   */
  aliases?: string[];
  label: string;
  detail?: string;
  scope: Scope;
  /** Shown in the palette's Actions group. */
  inPalette?: boolean;
  /** A short glyph for the palette row. */
  icon?: string;
}

export const SHORTCUTS: readonly Shortcut[] = [
  {
    id: 'palette',
    combo: '⌘K',
    label: 'Command palette',
    detail: 'Everything, by name',
    scope: 'global',
  },
  {
    id: 'open-files',
    combo: '⌘O',
    label: 'Compare files…',
    detail: 'Pick two files from disk',
    scope: 'global',
    inPalette: true,
    icon: '⇄',
  },
  {
    id: 'open-folders',
    combo: '⌘⇧O',
    label: 'Compare folders…',
    detail: 'Recursive tree diff',
    scope: 'global',
    inPalette: true,
    icon: 'DIR',
  },
  {
    id: 'paste-compare',
    combo: '⌘⇧V',
    // Plain ⌘V works too whenever you are not typing — handled by a `paste`
    // listener rather than a key binding, so text fields keep their own paste.
    aliases: ['⌘V'],
    label: 'Compare clipboard',
    detail: 'Paste A, then paste B',
    scope: 'global',
    inPalette: true,
    icon: '⧉',
  },
  {
    id: 'swap',
    combo: '⌘⇧S',
    label: 'Swap sides',
    detail: 'Before becomes after',
    scope: 'home',
    inPalette: true,
    icon: '⇅',
  },
  {
    id: 'export',
    combo: '⌘⇧E',
    label: 'Export report',
    detail: 'Repeats the last format used',
    scope: 'workspace',
    inPalette: true,
    icon: '↧',
  },
  {
    id: 'search',
    combo: '⌘F',
    label: 'Search in comparison',
    scope: 'workspace',
  },
  {
    id: 'view-mode',
    combo: '⌘\\',
    label: 'Cycle view mode',
    scope: 'workspace',
  },
  { id: 'next-change', combo: '⌥↓', label: 'Next change', scope: 'workspace' },
  { id: 'previous-change', combo: '⌥↑', label: 'Previous change', scope: 'workspace' },
  { id: 'view-compare', combo: '⌘1', label: 'Go to Compare', scope: 'global' },
  { id: 'view-history', combo: '⌘2', label: 'Go to History', scope: 'global' },
  {
    id: 'theme',
    combo: '⌘⇧L',
    label: 'Toggle theme',
    detail: 'Dark ↔ light',
    scope: 'global',
    inPalette: true,
    icon: '◐',
  },
  {
    id: 'settings',
    combo: '⌘,',
    label: 'Settings',
    detail: 'Theme, defaults and shortcuts',
    scope: 'global',
    inPalette: true,
    icon: '⚙',
  },
  { id: 'close', combo: 'Esc', label: 'Close overlay', scope: 'global' },
];

/** A parsed combo, in the shape a KeyboardEvent can be checked against. */
export interface ParsedCombo {
  meta: boolean;
  shift: boolean;
  alt: boolean;
  /** Lowercase, or a KeyboardEvent `key` value for named keys. */
  key: string;
}

const NAMED: Record<string, string> = {
  '↓': 'arrowdown',
  '↑': 'arrowup',
  '←': 'arrowleft',
  '→': 'arrowright',
  Esc: 'escape',
  '⏎': 'enter',
};

export function parseCombo(combo: string): ParsedCombo {
  const meta = combo.includes('⌘');
  const shift = combo.includes('⇧');
  const alt = combo.includes('⌥');
  const rest = combo.replace(/[⌘⇧⌥]/g, '');
  return { meta, shift, alt, key: (NAMED[rest] ?? rest).toLowerCase() };
}

export function matches(event: KeyboardEvent, combo: string): boolean {
  const parsed = parseCombo(combo);
  // ⌘ on macOS, Ctrl elsewhere — one table, both platforms.
  const meta = event.metaKey || event.ctrlKey;
  if (parsed.meta !== meta) return false;
  if (parsed.shift !== event.shiftKey) return false;
  if (parsed.alt !== event.altKey) return false;

  // ⇧ changes what `key` reports (⌘⇧E gives 'E'), so compare case-insensitively.
  return event.key.toLowerCase() === parsed.key;
}

/**
 * Two bindings that fire on the same keystroke are a bug the moment a user
 * finds it, so the registry refuses to hold one. Checked by a test rather than
 * at runtime, since the table is a constant.
 */
export function duplicateCombos(shortcuts: readonly Shortcut[] = SHORTCUTS): string[] {
  const seen = new Map<string, Scope[]>();

  // Aliases are bindings like any other: an alias that collides with a primary
  // combo is exactly as broken as two primaries colliding.
  for (const shortcut of shortcuts) {
    for (const combo of combosFor(shortcut)) {
      const scopes = seen.get(combo) ?? [];
      // The same combo may exist in two different scopes; only a clash within
      // one scope (or against a global) is ambiguous.
      const clashes = scopes.some(
        (scope) => scope === shortcut.scope || scope === 'global' || shortcut.scope === 'global',
      );
      if (clashes) return [combo];
      seen.set(combo, [...scopes, shortcut.scope]);
    }
  }

  return [];
}

/** Every key that fires this action, primary first. */
export function combosFor(shortcut: Shortcut): string[] {
  return [shortcut.combo, ...(shortcut.aliases ?? [])];
}

export function shortcutFor(id: string): Shortcut | undefined {
  return SHORTCUTS.find((shortcut) => shortcut.id === id);
}
