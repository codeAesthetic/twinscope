import type { JsonRow } from '../../../engines/json/jsonDiff';

/**
 * How the JSON diff is presented (MD §13, mockup `#s-json` seg).
 *
 * Every mode draws the *same* engine rows. That is the whole design: the
 * structural walk owns what differs and how many differences there are, and a
 * mode only chooses how to show them. A mode that computed its own diff — a
 * line diff of the reformatted documents, say — would report counts the summary
 * strip never agreed to, which is the trap the JSON engine exists to avoid
 * ("reformat a file and every line changes").
 *
 * `raw` is the exception and is deliberately not a diff: it shows the two
 * documents as they arrived, which is why it carries no rows at all.
 */
export type JsonViewMode = 'side' | 'unified' | 'inline' | 'tree' | 'raw';

/** Seg order, and the order `⌘\` cycles through. */
export const JSON_VIEW_MODES: readonly JsonViewMode[] = [
  'side',
  'unified',
  'inline',
  'tree',
  'raw',
];

/** Modes that lay rows out flat, addressed by path rather than by indentation. */
export function isFlat(mode: JsonViewMode): boolean {
  return mode === 'side' || mode === 'unified' || mode === 'inline';
}

export interface JsonDisplayRow {
  row: JsonRow;
  /** Index into `JsonDiffData.rows` — what `collapsed`/menus key off, not a position here. */
  index: number;
  /**
   * Which side of a split modification this row draws. Set only in `unified`,
   * where `chg` and `type` become two rows; `undefined` means "the whole row".
   */
  half?: 'before' | 'after';
  /**
   * False for the `+ after` half of a split: a modification is one change
   * however many rows draw it, so only the first half is a navigation stop.
   */
  anchor: boolean;
}

export interface BuildOptions {
  mode: JsonViewMode;
  /** Hide unchanged leaves and unchanged subtrees. */
  onlyChanges: boolean;
  /** Filter text; matches path, key, values and notes. */
  query: string;
  /** Collapsed container paths. `tree` only — a flat mode has no containers. */
  collapsed: ReadonlySet<string>;
  expandAll: boolean;
}

/**
 * The rows to paint, in order, for one mode.
 *
 * Pure so the mapping can be tested without a window: the index arithmetic here
 * is exactly what broke the text view three ways at once (see plan §9,
 * 2026-08-13) — one flat list serving rendering, navigation and filtering with
 * different index spaces.
 */
export function buildDisplayRows(
  rows: readonly JsonRow[],
  options: BuildOptions,
): JsonDisplayRow[] {
  const { mode, onlyChanges, query, collapsed, expandAll } = options;
  if (mode === 'raw') return [];

  const flat = isFlat(mode);
  const needle = query.trim().toLowerCase();
  const parents = parentIndexes(rows);

  const keep = rows.map((row) => {
    if (onlyChanges && row.container === undefined && row.state === 'same') return false;
    if (onlyChanges && row.container !== undefined && (row.changed ?? 0) === 0) return false;
    if (needle === '') return true;
    return rowText(row).toLowerCase().includes(needle);
  });

  // Ancestors of a kept row stay, so a match is never orphaned from its path.
  // Runs in every mode: a flat mode drops the containers below, but the pass
  // must not differ between modes or the counts would.
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    if (!keep[index]) continue;
    const parent = parents[index] ?? -1;
    if (parent >= 0) keep[parent] = true;
  }

  const out: JsonDisplayRow[] = [];
  let hiddenBelow = -1;

  rows.forEach((row, index) => {
    if (hiddenBelow >= 0 && row.depth > hiddenBelow) return;
    hiddenBelow = -1;
    if (!keep[index]) return;

    if (row.container !== undefined) {
      // A container carries no value, so a flat mode has nothing to show for it.
      if (flat) return;
      out.push({ row, index, anchor: true });
      if (!expandAll && collapsed.has(row.path)) hiddenBelow = row.depth;
      return;
    }

    // Unified splits a modification the way unified means everywhere else:
    // `− before` then `+ after`. Anything else hides the replacement text.
    if (mode === 'unified' && (row.state === 'chg' || row.state === 'type')) {
      out.push({ row, index, half: 'before', anchor: true });
      out.push({ row, index, half: 'after', anchor: false });
      return;
    }

    out.push({ row, index, anchor: true });
  });

  return out;
}

/** Parent row index for each row, derived from the depth column. */
export function parentIndexes(rows: readonly JsonRow[]): number[] {
  const out = new Array<number>(rows.length).fill(-1);
  const stack: number[] = [];
  rows.forEach((row, index) => {
    stack.length = row.depth;
    out[index] = row.depth === 0 ? -1 : (stack[row.depth - 1] ?? -1);
    stack[row.depth] = index;
  });
  return out;
}

/** Everything a filter query can match against. */
export function rowText(row: JsonRow): string {
  return [row.key, row.path, row.value, row.a, row.b, row.note].filter(Boolean).join(' ');
}

/** What a container shows in place of a value. */
export function containerText(row: JsonRow): string {
  return row.container === 'arr' ? '[ … ]' : '{ … }';
}

/**
 * The value on the BEFORE side, or `undefined` when the key is not there at all
 * — which is what the striped filler in side-by-side means.
 */
export function beforeText(row: JsonRow): string | undefined {
  if (row.container !== undefined) return containerText(row);
  if (row.state === 'add') return undefined;
  if (row.state === 'del' || row.state === 'chg' || row.state === 'type') return row.a;
  return row.value ?? row.a;
}

/** The value on the AFTER side, or `undefined` when the key was removed. */
export function afterText(row: JsonRow): string | undefined {
  if (row.container !== undefined) return containerText(row);
  if (row.state === 'del') return undefined;
  if (row.state === 'add' || row.state === 'chg' || row.state === 'type') return row.b;
  return row.value ?? row.b;
}

/**
 * The tone a value carries on a given side: struck-through `old` on the left of
 * a change, `new` on the right, and untoned when both sides agree.
 */
export function toneFor(row: JsonRow, side: 'before' | 'after'): 'old' | 'new' | undefined {
  if (row.container !== undefined || row.state === 'same' || row.state === 'ign') return undefined;
  if (side === 'before') return row.state === 'add' ? undefined : 'old';
  return row.state === 'del' ? undefined : 'new';
}

/** The one-character state marker: `+ − ~ ⚠`. Containers carry none. */
export function markFor(row: JsonRow): string {
  if (row.container !== undefined) return '';
  switch (row.state) {
    case 'add':
      return '+';
    case 'del':
      return '−';
    case 'chg':
      return '~';
    case 'type':
      return '⚠';
    default:
      return '';
  }
}
