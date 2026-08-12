// PLACEHOLDER content that the product cannot produce yet.
//
// The recent-comparison and history fixtures left with MVP-8, which made both
// lists live. What remains is the quick-start deck (its flows land with the
// keyboard map in MVP-10) and the shortcut table, which MVP-10 replaces with a
// generated one. Kept in one module so each removal stays a single deletion.

import type { FileKind } from '../components/primitives';

export interface QuickStart {
  id: string;
  kind: FileKind;
  title: string;
  description: string;
}

/** The four fastest ways in (MD §34/§35). Wired up across MVP-2 and V1. */
export const QUICK_STARTS: readonly QuickStart[] = [
  {
    id: 'folders',
    kind: 'folder',
    title: 'Folders',
    description: 'Recursive tree diff with size & rename hints.',
  },
  {
    id: 'clipboard',
    kind: 'code',
    title: 'Clipboard',
    description: '⌘⇧V twice — text, JSON, URL or image.',
  },
  {
    id: 'screenshots',
    kind: 'image',
    title: 'Screenshots',
    description: 'Overlay, blink and pixel heatmap.',
  },
  {
    id: 'git',
    kind: 'web',
    title: 'Git refs',
    description: 'Branch, tag, commit or range.',
  },
];

export interface ShortcutEntry {
  label: string;
  keys: string;
}

/**
 * Display-only for now. MVP-10 builds the real registry and generates both the
 * bindings and this grid from it, so they cannot disagree.
 */
export const SHORTCUTS: readonly ShortcutEntry[] = [
  { label: 'Command palette', keys: '⌘K' },
  { label: 'Compare files', keys: '⌘O' },
  { label: 'Compare folders', keys: '⌘⇧O' },
  { label: 'Paste to compare', keys: '⌘⇧V' },
  { label: 'Next change', keys: '⌥↓' },
  { label: 'Previous change', keys: '⌥↑' },
  { label: 'Toggle view mode', keys: '⌘\\' },
  { label: 'Swap sides', keys: '⌘⇧S' },
  { label: 'Find in diff', keys: '⌘F' },
  { label: 'Export report', keys: '⌘⇧E' },
  { label: 'Quick Compare window', keys: '⌘⌥D' },
  { label: 'Settings', keys: '⌘,' },
];
