import { describe, expect, it } from 'vitest';
import {
  afterText,
  beforeText,
  buildDisplayRows,
  isFlat,
  JSON_VIEW_MODES,
  markFor,
  parentIndexes,
  toneFor,
  type JsonViewMode,
} from './jsonView';
import type { JsonRow } from '../../../engines/json/jsonDiff';

/**
 * The mockup's demo shape, trimmed to one of each state:
 *
 *   $ { }
 *     user { }
 *       name   "Ada L." → "Ada Lovelace"   chg
 *       age    27 → "27"                   type
 *       phone  "+1 415…"                   add
 *       avatar "https://…"                 del
 *       id     "u_10482"                   same
 */
const ROWS: JsonRow[] = [
  { depth: 0, key: '$', path: '$', state: 'same', container: 'obj', changed: 4 },
  { depth: 1, key: 'user', path: '$.user', state: 'same', container: 'obj', changed: 4 },
  { depth: 2, key: 'name', path: '$.user.name', state: 'chg', a: '"Ada L."', b: '"Ada Lovelace"' },
  {
    depth: 2,
    key: 'age',
    path: '$.user.age',
    state: 'type',
    a: '27',
    b: '"27"',
    note: 'number → string',
  },
  { depth: 2, key: 'phone', path: '$.user.phone', state: 'add', b: '"+1 415 555 0132"' },
  { depth: 2, key: 'avatar', path: '$.user.avatar', state: 'del', a: '"https://cdn/a.png"' },
  { depth: 2, key: 'id', path: '$.user.id', state: 'same', value: '"u_10482"' },
];

const BASE = {
  onlyChanges: true,
  query: '',
  collapsed: new Set<string>(),
  expandAll: false,
};

const build = (mode: JsonViewMode, overrides: Partial<typeof BASE> = {}) =>
  buildDisplayRows(ROWS, { mode, ...BASE, ...overrides });

/** Changes as the ‹ n/m › strip counts them: anchors only, leaves only. */
const changeCount = (mode: JsonViewMode): number =>
  build(mode).filter(
    ({ row, anchor }) =>
      anchor && row.container === undefined && row.state !== 'same' && row.state !== 'ign',
  ).length;

describe('buildDisplayRows', () => {
  it('drops containers in the flat modes and keeps them in the tree', () => {
    expect(build('tree').filter(({ row }) => row.container !== undefined)).toHaveLength(2);
    for (const mode of ['side', 'unified', 'inline'] as const) {
      expect(build(mode).filter(({ row }) => row.container !== undefined)).toEqual([]);
    }
  });

  it('reports the same number of changes in every mode', () => {
    // Four differences: name, age, phone, avatar. The mode is a presentation,
    // so a mode that changed this number would make the summary strip lie.
    for (const mode of ['side', 'unified', 'inline', 'tree'] as const) {
      expect(changeCount(mode), mode).toBe(4);
    }
  });

  it('splits a modification into two rows in unified, and only one is a stop', () => {
    const unified = build('unified');
    const halves = unified.filter(({ row }) => row.path === '$.user.name');
    expect(halves.map((entry) => entry.half)).toEqual(['before', 'after']);
    expect(halves.map((entry) => entry.anchor)).toEqual([true, false]);

    // A type change splits the same way — it is a modification of the value too.
    expect(unified.filter(({ row }) => row.path === '$.user.age')).toHaveLength(2);
    // Side and inline keep it as one row carrying both versions.
    expect(build('side').filter(({ row }) => row.path === '$.user.name')).toHaveLength(1);
    expect(build('inline').filter(({ row }) => row.path === '$.user.name')).toHaveLength(1);
  });

  it('hides unchanged leaves until "only changes" is off', () => {
    expect(build('side').some(({ row }) => row.path === '$.user.id')).toBe(false);
    expect(build('side', { onlyChanges: false }).some(({ row }) => row.path === '$.user.id')).toBe(
      true,
    );
  });

  it('filters by path or value, and keeps ancestors in the tree', () => {
    const tree = build('tree', { query: 'Lovelace' });
    expect(tree.map(({ row }) => row.path)).toEqual(['$', '$.user', '$.user.name']);

    // The same filter in a flat mode yields the matching leaf and nothing else:
    // there is no spine to keep.
    expect(build('side', { query: 'Lovelace' }).map(({ row }) => row.path)).toEqual([
      '$.user.name',
    ]);
    expect(build('side', { query: 'nothing here' })).toEqual([]);
  });

  it('collapses a subtree in the tree only', () => {
    const collapsed = new Set(['$.user']);
    expect(build('tree', { collapsed }).map(({ row }) => row.path)).toEqual(['$', '$.user']);
    // Flat modes have no twisties, so a stale collapsed path cannot hide rows.
    expect(build('inline', { collapsed })).toHaveLength(4);
    // Expand all wins over the collapsed set.
    expect(build('tree', { collapsed, expandAll: true }).length).toBeGreaterThan(2);
  });

  it('has no rows at all in raw — it shows the documents, not a diff', () => {
    expect(build('raw')).toEqual([]);
  });
});

describe('parentIndexes', () => {
  it('points every row at its container', () => {
    expect(parentIndexes(ROWS)).toEqual([-1, 0, 1, 1, 1, 1, 1]);
  });
});

describe('side values', () => {
  const byPath = (path: string): JsonRow => ROWS.find((row) => row.path === path)!;

  it('leaves the absent side undefined, which is what the filler means', () => {
    expect(beforeText(byPath('$.user.phone'))).toBeUndefined();
    expect(afterText(byPath('$.user.phone'))).toBe('"+1 415 555 0132"');
    expect(beforeText(byPath('$.user.avatar'))).toBe('"https://cdn/a.png"');
    expect(afterText(byPath('$.user.avatar'))).toBeUndefined();
  });

  it('shows both versions of a change and one value when the sides agree', () => {
    expect(beforeText(byPath('$.user.name'))).toBe('"Ada L."');
    expect(afterText(byPath('$.user.name'))).toBe('"Ada Lovelace"');
    expect(beforeText(byPath('$.user.id'))).toBe('"u_10482"');
    expect(afterText(byPath('$.user.id'))).toBe('"u_10482"');
  });

  it('renders a container as its brace, on both sides', () => {
    expect(beforeText(byPath('$.user'))).toBe('{ … }');
    expect(afterText(byPath('$'))).toBe('{ … }');
  });

  it('tones the old side struck-through and the new side added', () => {
    expect(toneFor(byPath('$.user.name'), 'before')).toBe('old');
    expect(toneFor(byPath('$.user.name'), 'after')).toBe('new');
    // An addition has no old value to strike through.
    expect(toneFor(byPath('$.user.phone'), 'before')).toBeUndefined();
    expect(toneFor(byPath('$.user.id'), 'after')).toBeUndefined();
  });

  it('marks each state, and never a container', () => {
    expect(ROWS.map(markFor)).toEqual(['', '', '~', '⚠', '+', '−', '']);
  });
});

describe('mode helpers', () => {
  it('lists every mode once, side-by-side first', () => {
    expect(JSON_VIEW_MODES[0]).toBe('side');
    expect(new Set(JSON_VIEW_MODES).size).toBe(JSON_VIEW_MODES.length);
  });

  it('knows which modes are flat', () => {
    expect(JSON_VIEW_MODES.filter(isFlat)).toEqual(['side', 'unified', 'inline']);
  });
});
