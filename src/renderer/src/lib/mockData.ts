// PLACEHOLDER — replaced in MVP-8, when history comes from SQLite.
//
// Kept in one module so the swap is a single deletion rather than a hunt
// through components. Values mirror reference/devdiff-mockup.html.

import type { ChipVariant, FileKind } from '../components/primitives';

export interface SummaryChip {
  label: string;
  variant: ChipVariant;
}

export interface ComparisonRecord {
  id: string;
  kind: FileKind;
  title: string;
  /** The two inputs, as the user would recognise them. */
  path: string;
  chips: SummaryChip[];
  /** Pre-formatted for now; MVP-8 stores timestamps and formats them here. */
  ago: string;
  starred?: boolean;
}

export const RECENT_COMPARISONS: readonly ComparisonRecord[] = [
  {
    id: 'r1',
    kind: 'json',
    title: 'users-v2.4.json',
    path: '~/api/snapshots/users-v2.3.json ↔ users-v2.4.json',
    chips: [
      { label: '＋3', variant: 'add' },
      { label: '－1', variant: 'del' },
      { label: '～7', variant: 'mod' },
    ],
    ago: '2 min ago',
  },
  {
    id: 'r2',
    kind: 'image',
    title: 'Homepage screenshot',
    path: '~/qa/baseline/home.png ↔ ~/qa/current/home.png',
    chips: [
      { label: '4.8%', variant: 'info' },
      { label: '7 regions', variant: 'mod' },
    ],
    ago: '1 hour ago',
  },
  {
    id: 'r3',
    kind: 'code',
    title: 'src/api/client.ts',
    path: 'working tree ↔ origin/main',
    chips: [
      { label: '＋18', variant: 'add' },
      { label: '－7', variant: 'del' },
    ],
    ago: '3 hours ago',
  },
  {
    id: 'r4',
    kind: 'folder',
    title: 'app-v2.3.0 ↔ app-v2.4.0',
    path: '~/work/app-v2.3.0 ↔ ~/work/app-v2.4.0',
    chips: [
      { label: '12 files', variant: 'mod' },
      { label: '1 rename', variant: 'info' },
    ],
    ago: 'Yesterday',
  },
  {
    id: 'r5',
    kind: 'md',
    title: 'CHANGELOG.md',
    path: 'release-v2.4 report',
    chips: [{ label: '＋94', variant: 'add' }],
    ago: 'Aug 10',
  },
];

export interface HistoryGroup {
  label: string;
  items: readonly ComparisonRecord[];
}

/** MVP-8 derives these buckets from stored timestamps. */
export const HISTORY_GROUPS: readonly HistoryGroup[] = [
  {
    label: 'Today',
    items: [
      { ...RECENT_COMPARISONS[0]!, id: 'h1', starred: true },
      { ...RECENT_COMPARISONS[1]!, id: 'h2', starred: true },
      { ...RECENT_COMPARISONS[2]!, id: 'h3' },
      {
        id: 'h4',
        kind: 'web',
        title: 'checkout.har ↔ checkout-2.har',
        path: 'api engine · 41 requests',
        chips: [
          { label: '+3 requests', variant: 'info' },
          { label: '～11', variant: 'mod' },
        ],
        ago: '5 hours ago',
      },
    ],
  },
  {
    label: 'Yesterday',
    items: [
      { ...RECENT_COMPARISONS[3]!, id: 'h5' },
      {
        id: 'h6',
        kind: 'json',
        title: 'k8s/staging.yaml ↔ k8s/prod.yaml',
        path: 'yaml engine · config drift',
        chips: [
          { label: '～9', variant: 'mod' },
          { label: '－2', variant: 'del' },
        ],
        ago: 'Yesterday 11:20',
      },
    ],
  },
  {
    label: 'Earlier',
    items: [
      { ...RECENT_COMPARISONS[4]!, id: 'h7' },
      {
        id: 'h8',
        kind: 'folder',
        title: 'schema.dev ↔ schema.prod',
        path: 'schema engine · 4 tables',
        chips: [
          { label: '＋2 cols', variant: 'add' },
          { label: '－1 col', variant: 'del' },
        ],
        ago: 'Aug 8',
      },
    ],
  },
];

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
