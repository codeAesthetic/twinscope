import { describe, expect, it } from 'vitest';
import { looksLikeYaml, parseYaml, toComparable, YamlParseError } from './yamlDiff';
import { yamlEngine } from './index';
import { EngineInputError, type EngineCtx, type InputRef } from '../types';

const ctx = (): EngineCtx => ({
  signal: new AbortController().signal,
  progress: () => undefined,
});

const ref = (side: 'A' | 'B', name: string, text: string, kind = 'yaml'): InputRef =>
  ({ side, kind, name, size: text.length, text }) as InputRef;

async function compare(before: string, after: string, kinds: [string, string] = ['yaml', 'yaml']) {
  return yamlEngine.compare(
    ref('A', 'before.yaml', before, kinds[0]),
    ref('B', 'after.yaml', after, kinds[1]),
    yamlEngine.defaultOptions(),
    ctx(),
  );
}

describe('parseYaml', () => {
  it('reads a mapping as a plain object', () => {
    expect(parseYaml('name: one\ncount: 2\n', 'a.yaml').value).toEqual({ name: 'one', count: 2 });
  });

  it('reads a stream of documents as an array, and says it did', () => {
    // Losing all but the first document would be a wrong answer that looks right,
    // and a `---`-separated stream is how Kubernetes manifests are normally written.
    const parsed = parseYaml('kind: A\n---\nkind: B\n', 'k8s.yaml');
    expect(parsed.documents).toBe(2);
    expect(parsed.value).toEqual([{ kind: 'A' }, { kind: 'B' }]);
    expect(parsed.notes.join(' ')).toContain('stream of 2 documents');
  });

  it('does not treat a single document as a stream of one', () => {
    const parsed = parseYaml('kind: A\n', 'one.yaml');
    expect(parsed.documents).toBe(1);
    expect(parsed.value).toEqual({ kind: 'A' });
    expect(parsed.notes.join(' ')).not.toContain('stream');
  });

  it('reads an empty document as null rather than failing', () => {
    expect(parseYaml('', 'empty.yaml').value).toBeNull();
    expect(parseYaml('# only a comment\n', 'empty.yaml').value).toBeNull();
  });

  it('expands aliases and reports that it did — Rule 3', () => {
    const parsed = parseYaml(
      'defaults: &d\n  retries: 3\nprod:\n  <<: *d\n  host: example.com\n',
      'app.yaml',
    );
    expect(parsed.value).toEqual({
      defaults: { retries: 3 },
      prod: { retries: 3, host: 'example.com' },
    });
    const notes = parsed.notes.join(' ');
    expect(notes).toContain('Expanded 1 alias');
    expect(notes).toContain('merge key');
  });

  it('mentions an anchor even when nothing references it', () => {
    const parsed = parseYaml('base: &unused\n  a: 1\n', 'a.yaml');
    expect(parsed.notes.join(' ')).toContain('declares 1 anchor');
  });

  it('throws a located error, which the engine turns into a text fallback', () => {
    // A tab is the classic YAML indentation failure.
    expect(() => parseYaml('a:\n\t- 1\n', 'bad.yaml')).toThrow(YamlParseError);
    try {
      parseYaml('a: [1, 2\nb: 3\n', 'bad.yaml');
      expect.unreachable('should have thrown');
    } catch (cause) {
      expect(cause).toBeInstanceOf(YamlParseError);
      expect((cause as YamlParseError).message).toContain('bad.yaml is not valid YAML');
      expect((cause as YamlParseError).line).toBeGreaterThan(0);
    }
  });
});

describe('toComparable', () => {
  it('turns a Date into its ISO form, which the JSON core can compare', () => {
    // `typeOf` would otherwise call a Date an object, and two different dates
    // would compare as two identical empty objects.
    expect(toComparable(new Date('2026-08-13T10:00:00Z'))).toBe('2026-08-13T10:00:00.000Z');
    expect(toComparable(new Date('nonsense'))).toBe('invalid date');
  });

  it('keeps .inf and .nan distinguishable from null', () => {
    // JSON.stringify renders all three as `null`, which would equate `.inf` with `~`.
    expect(toComparable(Number.POSITIVE_INFINITY)).toBe('.inf');
    expect(toComparable(Number.NEGATIVE_INFINITY)).toBe('-.inf');
    expect(toComparable(Number.NaN)).toBe('.nan');
    expect(toComparable(null)).toBeNull();
  });

  it('flattens a Map and a Set, which stringify as {} otherwise', () => {
    expect(toComparable(new Map([['a', 1]]))).toEqual({ a: 1 });
    expect(toComparable(new Set([1, 2]))).toEqual([1, 2]);
    // A non-string key keeps its printed form rather than becoming "[object Object]".
    expect(toComparable(new Map<unknown, unknown>([[{ k: 1 }, 'v']]))).toEqual({
      '{"k":1}': 'v',
    });
  });

  it('names binary by length instead of comparing megabytes of bytes', () => {
    expect(toComparable(new Uint8Array([1, 2, 3]))).toBe('!!binary (3 bytes)');
  });

  it('survives a cycle', () => {
    const node: Record<string, unknown> = { name: 'a' };
    node.self = node;
    expect(toComparable(node)).toEqual({ name: 'a', self: '[circular]' });
  });

  it('does not mistake a repeated sibling for a cycle', () => {
    // An alias legitimately produces the same object twice; only a cycle is a
    // problem, which is why the seen-set is popped on the way out.
    const shared = { a: 1 };
    expect(toComparable({ one: shared, two: shared })).toEqual({ one: { a: 1 }, two: { a: 1 } });
  });

  it('walks nested structures', () => {
    expect(toComparable({ list: [new Date(0), { n: Number.NaN }] })).toEqual({
      list: ['1970-01-01T00:00:00.000Z', { n: '.nan' }],
    });
  });
});

describe('looksLikeYaml', () => {
  it('recognises mapping-shaped text', () => {
    expect(looksLikeYaml('name: one\nversion: 2\nsteps:\n  - run: build\n')).toBe(true);
  });

  it('does not claim prose', () => {
    expect(looksLikeYaml('This is a paragraph of prose. It has no keys at all.\n')).toBe(false);
    expect(looksLikeYaml('')).toBe(false);
  });
});

describe('the yaml engine', () => {
  it('claims two YAMLs, and a YAML against a JSON', () => {
    const yaml = { side: 'A', kind: 'yaml', name: 'a.yaml', size: 0 } as InputRef;
    const json = { side: 'B', kind: 'json', name: 'b.json', size: 0 } as InputRef;
    const text = { side: 'B', kind: 'text', name: 'b.txt', size: 0 } as InputRef;

    expect(yamlEngine.canHandle(yaml, { ...yaml, side: 'B' })).toBe(true);
    // YAML is a superset of JSON, so this pair compares structurally rather than
    // falling through to a line diff.
    expect(yamlEngine.canHandle(yaml, json)).toBe(true);
    expect(yamlEngine.canHandle(json, yaml)).toBe(true);
    // Two JSONs belong to the JSON engine, not this one.
    expect(yamlEngine.canHandle(json, { ...json, side: 'A' })).toBe(false);
    expect(yamlEngine.canHandle(yaml, text)).toBe(false);
  });

  it('compares structurally, so key order is not a difference', async () => {
    const result = await compare('a: 1\nb: 2\n', 'b: 2\na: 1\n');
    expect(result.summary).toMatchObject({ added: 0, removed: 0, modified: 0 });
    expect(result.engineId).toBe('yaml');
  });

  it('reports adds, removes and changes the way the JSON engine does', async () => {
    const result = await compare('name: one\ngone: true\n', 'name: two\nextra: 1\n');
    expect(result.summary).toMatchObject({ added: 1, removed: 1, modified: 1 });
  });

  it('sees an anchor and its expansion as the same data', async () => {
    const withAnchor = 'defaults: &d\n  retries: 3\nprod:\n  <<: *d\n';
    const written = 'defaults:\n  retries: 3\nprod:\n  retries: 3\n';
    const result = await compare(withAnchor, written);
    expect(result.summary).toMatchObject({ added: 0, removed: 0, modified: 0 });
    // True, but surprising — so it has to be said.
    expect(result.normalizationNotes.join(' ')).toContain('Expanded 1 alias');
  });

  it('compares a YAML against the JSON that means the same thing', async () => {
    const result = await compare(
      'name: one\nlist:\n  - 1\n  - 2\n',
      '{"name":"one","list":[1,2]}',
      ['yaml', 'json'],
    );
    expect(result.summary).toMatchObject({ added: 0, removed: 0, modified: 0 });
    expect(result.summary.extra?.formats).toBe('yaml ↔ json');
  });

  it('reads a quoted number as a string, and calls that a type change', async () => {
    const result = await compare('port: 8080\n', "port: '8080'\n");
    expect(result.summary.modified).toBe(1);
    expect(result.summary.extra?.['type change']).toBe('⚠ 1');
  });

  it('offers the text engine when the YAML will not parse', async () => {
    await expect(compare('a: [1, 2\n', 'a: [1, 2]\n')).rejects.toThrow(EngineInputError);
    try {
      await compare('a: [1, 2\n', 'b: 1\n');
      expect.unreachable('should have thrown');
    } catch (cause) {
      expect((cause as EngineInputError).fallback).toEqual({
        fallbackEngineId: 'text',
        fallbackLabel: 'Compare as text',
      });
      expect((cause as Error).message).toMatch(/line \d+, column \d+/);
    }
  });

  it('compares two streams document by document', async () => {
    const result = await compare('kind: A\n---\nkind: B\n', 'kind: A\n---\nkind: C\n');
    expect(result.summary.modified).toBe(1);
    expect(result.normalizationNotes.join(' ')).toContain('stream of 2 documents');
  });

  it('notices a document appearing in the stream', async () => {
    const result = await compare('kind: A\n', 'kind: A\n---\nkind: B\n');
    // One document against two: the JSON core sees a scalar-to-array change.
    expect(result.summary.added + result.summary.modified).toBeGreaterThan(0);
  });

  it('needs a filesystem only when the text was not inlined', async () => {
    await expect(
      yamlEngine.compare(
        { side: 'A', kind: 'yaml', name: 'a.yaml', path: '/tmp/a.yaml', size: 10 },
        { side: 'B', kind: 'yaml', name: 'b.yaml', path: '/tmp/b.yaml', size: 10 },
        yamlEngine.defaultOptions(),
        ctx(),
      ),
    ).rejects.toThrow(/No filesystem access/);
  });
});
