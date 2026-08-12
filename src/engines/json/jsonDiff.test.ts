import { describe, expect, it } from 'vitest';
import { compileIgnore, DEFAULT_JSON_OPTIONS, diffJson, type JsonDiffOptions } from './jsonDiff';
import { jsonEngine } from './index';
import type { EngineCtx, InputRef } from '../types';

const options = (patch: Partial<JsonDiffOptions> = {}): JsonDiffOptions => ({
  ...DEFAULT_JSON_OPTIONS,
  ...patch,
});

/** The mockup's demo pair (users v2.3 → v2.4), ported verbatim. */
const DEMO_A = {
  user: {
    id: 'u_10482',
    name: 'Ada L.',
    email: 'ada@calc.dev',
    status: 'pending',
    age: 27,
    avatar: 'https://cdn.calc.dev/a/1f2.png',
    address: { city: 'London', zip: 'CB2 1TN', country: 'UK' },
    roles: ['viewer'],
    plan: { tier: 'free', limits: { seats: 1, requests: 1000 } },
  },
  meta: { requestId: 'r_881', updatedAt: '2026-08-12T09:00:00Z' },
  server: { region: 'eu-west-1', latencyMs: 41 },
};

const DEMO_B = {
  user: {
    id: 'u_10482',
    name: 'Ada Lovelace',
    email: 'ada@calc.dev',
    status: 'active',
    age: '27',
    phone: '+1 415 555 0132',
    address: { city: 'Cambridge', zip: 'CB2 1TN', country: 'UK' },
    roles: ['viewer', 'editor', 'billing'],
    plan: { tier: 'pro', limits: { seats: 5, requests: 50000 } },
  },
  meta: { requestId: 'r_902', updatedAt: '2026-08-12T09:04:11Z' },
  server: { region: 'eu-west-1', latencyMs: '38' },
};

describe('diffJson — the demo pair', () => {
  const { data, stats } = diffJson(DEMO_A, DEMO_B, options());

  it('finds the added, removed and changed fields', () => {
    // phone + two roles added; avatar removed; name, status, city, tier, seats,
    // requests, requestId and updatedAt changed; age and latencyMs changed type.
    expect(stats.added).toBe(3);
    expect(stats.removed).toBe(1);
    expect(stats.changed).toBe(8);
    expect(stats.typeChanged).toBe(2);
  });

  it('reports a type change rather than a value change', () => {
    const age = data.rows.find((row) => row.path === '$.user.age');
    expect(age?.state).toBe('type');
    expect(age?.note).toBe('number → string');
    expect(age?.a).toBe('27');
    expect(age?.b).toBe('"27"');
  });

  it('gives containers a changed-descendant count', () => {
    const address = data.rows.find((row) => row.path === '$.user.address');
    expect(address?.container).toBe('obj');
    expect(address?.changed).toBe(1);
    expect(address?.badge?.text).toBe('1 changed');
  });

  it('labels arrays with their length change', () => {
    const roles = data.rows.find((row) => row.path === '$.user.roles');
    expect(roles?.container).toBe('arr');
    expect(roles?.badge?.text).toContain('1 → 3 items');
  });

  it('builds JSONPaths that name the node', () => {
    expect(data.rows.map((row) => row.path)).toContain('$.user.plan.limits.seats');
    expect(data.rows[0]?.path).toBe('$');
  });

  it('suppresses nothing when no normalisation hides anything', () => {
    expect(stats.suppressed).toBe(0);
  });
});

describe('normalisation options', () => {
  it('ignores paths by glob and counts what it hid', () => {
    const { stats, data } = diffJson(
      DEMO_A,
      DEMO_B,
      options({ ignorePaths: ['meta.requestId', '*.updatedAt'] }),
    );
    // Both meta changes vanish from the change counts...
    expect(stats.changed).toBe(6);
    // ...and are reported instead of dropped silently (Rule 3).
    expect(stats.suppressed).toBe(2);
    expect(data.rows.find((row) => row.path === '$.meta.requestId')?.state).toBe('ign');
  });

  it('matches array indices with the [*] glob', () => {
    const before = { orders: [{ etag: 'a', total: 1 }] };
    const after = { orders: [{ etag: 'b', total: 1 }] };
    const { stats } = diffJson(
      before,
      after,
      options({ ignoreArrayOrder: false, ignorePaths: ['orders[*].etag'] }),
    );
    expect(stats.changed).toBe(0);
    expect(stats.suppressed).toBe(1);
  });

  it('treats null as missing only when asked', () => {
    const before = { a: null, b: 1 };
    const after = { b: 1 };

    expect(diffJson(before, after, options()).stats.removed).toBe(1);

    const lenient = diffJson(before, after, options({ ignoreNulls: true })).stats;
    expect(lenient.removed).toBe(0);
    expect(lenient.suppressed).toBe(1);
  });

  it('reads a reordered array as unchanged under identity matching', () => {
    const before = { tags: ['a', 'b', 'c'] };
    const after = { tags: ['c', 'a', 'b'] };

    const byIdentity = diffJson(before, after, options({ ignoreArrayOrder: true })).stats;
    expect(byIdentity.changed).toBe(0);
    expect(byIdentity.added + byIdentity.removed).toBe(0);

    // Index-based matching sees the same data as three edited slots.
    const byIndex = diffJson(before, after, options({ ignoreArrayOrder: false })).stats;
    expect(byIndex.changed).toBe(3);
  });

  it('sorts object keys only when key order is ignored', () => {
    const before = { b: 1, a: 1 };
    const after = { a: 1, b: 1 };

    const sorted = diffJson(before, after, options({ ignoreKeyOrder: true })).data.rows;
    expect(sorted.slice(1).map((row) => row.key)).toEqual(['a', 'b']);

    const unsorted = diffJson(before, after, options({ ignoreKeyOrder: false })).data.rows;
    expect(unsorted.slice(1).map((row) => row.key)).toEqual(['b', 'a']);
  });

  it('names every applied normalisation', () => {
    const { notes } = diffJson(DEMO_A, DEMO_B, options({ ignorePaths: ['meta.requestId'] }));
    expect(notes.join(' ')).toContain('order ignored');
    expect(notes.join(' ')).toContain('identity');
    expect(notes.join(' ')).toContain('meta.requestId');
  });
});

describe('ignore globs', () => {
  it('escapes regex metacharacters in literal segments', () => {
    expect(compileIgnore('a.b').test('a.b')).toBe(true);
    expect(compileIgnore('a.b').test('axb')).toBe(false);
    expect(compileIgnore('a+b').test('a+b')).toBe(true);
  });

  it('confines * to a single segment', () => {
    expect(compileIgnore('*.updatedAt').test('meta.updatedAt')).toBe(true);
    expect(compileIgnore('*.updatedAt').test('a.b.updatedAt')).toBe(false);
  });

  it('matches only numeric indices with [*]', () => {
    expect(compileIgnore('o[*].e').test('o[12].e')).toBe(true);
    expect(compileIgnore('o[*].e').test('o[x].e')).toBe(false);
  });
});

describe('guards', () => {
  it('caps depth instead of blowing the stack', () => {
    let deep: Record<string, unknown> = { end: 1 };
    for (let level = 0; level < 200; level += 1) deep = { nest: deep };
    const { notes } = diffJson(deep, deep, options());
    expect(notes.join(' ')).toContain('Stopped descending');
  });

  it('honours the abort signal mid-walk', () => {
    const wide = { items: Array.from({ length: 500 }, (_, index) => ({ id: index })) };
    expect(() => diffJson(wide, wide, options(), () => true)).toThrow(/cancelled/i);
  });
});

describe('jsonEngine', () => {
  const ctx = (): EngineCtx => ({
    signal: new AbortController().signal,
    progress: () => undefined,
  });
  const ref = (side: 'A' | 'B', name: string, text: string): InputRef => ({
    side,
    kind: 'json',
    name,
    text,
    size: text.length,
  });

  it('claims two JSON inputs and nothing else', () => {
    expect(jsonEngine.canHandle(ref('A', 'a.json', '{}'), ref('B', 'b.json', '{}'))).toBe(true);
    expect(
      jsonEngine.canHandle({ ...ref('A', 'a.txt', ''), kind: 'text' }, ref('B', 'b.json', '{}')),
    ).toBe(false);
  });

  it('summarises type changes as modifications, with their own chip', async () => {
    const result = await jsonEngine.compare(
      ref('A', 'a.json', JSON.stringify(DEMO_A)),
      ref('B', 'b.json', JSON.stringify(DEMO_B)),
      jsonEngine.defaultOptions(),
      ctx(),
    );

    expect(result.summary.added).toBe(3);
    expect(result.summary.removed).toBe(1);
    expect(result.summary.modified).toBe(10);
    expect(result.summary.extra?.['type changes']).toBe('⚠ 2');
  });

  it('offers a text-diff fallback when the JSON will not parse', async () => {
    await expect(
      jsonEngine.compare(
        ref('A', 'broken.json', '{ "a": 1, }'),
        ref('B', 'b.json', '{}'),
        jsonEngine.defaultOptions(),
        ctx(),
      ),
    ).rejects.toMatchObject({
      name: 'EngineInputError',
      fallback: { fallbackEngineId: 'text' },
    });
  });

  it('points at the line and column that broke the parse', async () => {
    const broken = '{\n  "a": 1,\n}\n';
    await expect(
      jsonEngine.compare(
        ref('A', 'broken.json', broken),
        ref('B', 'b.json', '{}'),
        jsonEngine.defaultOptions(),
        ctx(),
      ),
    ).rejects.toThrow(/line \d+, column \d+/);
  });
});
