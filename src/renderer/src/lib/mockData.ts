// PLACEHOLDER content that the product cannot produce yet.
//
// The history fixtures left with MVP-8 and the shortcut table with MVP-10,
// which generates it from the real registry. What remains is the quick-start
// deck: two of its four flows (URLs, Git refs) are v0.2.0 features, so the cards
// stay descriptive until then. Kept in one module so each removal is a single
// deletion.

import type { FileKind } from '../components/primitives';

export interface QuickStart {
  id: string;
  kind: FileKind;
  title: string;
  description: string;
}

/** The four fastest ways in (MD §34/§35). Wired up across MVP-2 and v0.2.0. */
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
