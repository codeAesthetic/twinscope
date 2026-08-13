import { describe, expect, it } from 'vitest';
import { ATTRIBUTE_PREFIX, parseXml, TEXT_KEY, XmlParseError } from './xmlDiff';
import { xmlEngine } from './index';
import { EngineInputError, type EngineCtx, type InputRef } from '../types';
import type { JsonRow } from '../json/jsonDiff';

const ctx = (): EngineCtx => ({
  signal: new AbortController().signal,
  progress: () => undefined,
});

const ref = (side: 'A' | 'B', text: string): InputRef => ({
  side,
  kind: 'xml',
  name: side === 'A' ? 'before.xml' : 'after.xml',
  size: text.length,
  text,
});

async function compare(before: string, after: string, options = xmlEngine.defaultOptions()) {
  return xmlEngine.compare(ref('A', before), ref('B', after), options, ctx());
}

/** The changed rows, which is what any assertion here actually cares about. */
function changed(rows: readonly JsonRow[]): JsonRow[] {
  return rows.filter((row) => row.state !== 'same' && row.state !== 'ign');
}

describe('parseXml', () => {
  it('reads attributes and text into one object, so each is its own row', () => {
    expect(parseXml('<item id="a">Hello</item>', 'a.xml').value).toEqual({
      item: [{ [`${ATTRIBUTE_PREFIX}id`]: 'a', [TEXT_KEY]: 'Hello' }],
    });
  });

  it('makes every element a list, even when there is one of it', () => {
    // The reason: without this, one <item> parses to an object and two parse to an
    // array, so *adding the second* reports a type change rather than an addition.
    expect(parseXml('<root><item>a</item></root>', 'a.xml').value).toEqual({
      root: [{ item: [{ [TEXT_KEY]: 'a' }] }],
    });
  });

  it('does not coerce values to numbers', () => {
    // `<id>007</id>` read as the number 7 loses information, and would equate
    // `<v>1.0</v>` with `<v>1</v>`.
    expect(parseXml('<r><id>007</id><v>1.0</v></r>', 'a.xml').value).toEqual({
      r: [{ id: [{ [TEXT_KEY]: '007' }], v: [{ [TEXT_KEY]: '1.0' }] }],
    });
  });

  it('gives every element a text node, so adding an attribute is not a type change', () => {
    // Without `alwaysCreateTextNode` a bare leaf is a string and a leaf with an
    // attribute is an object — the same trap as `isArray`, one level down.
    expect(parseXml('<id>7</id>', 'a.xml').value).toEqual({ id: [{ [TEXT_KEY]: '7' }] });
    expect(parseXml('<id x="1">7</id>', 'a.xml').value).toEqual({
      id: [{ [TEXT_KEY]: '7', [`${ATTRIBUTE_PREFIX}x`]: '1' }],
    });
    // And an empty element is an empty text node rather than a different shape.
    expect(parseXml('<a/>', 'a.xml').value).toEqual({ a: [{ [TEXT_KEY]: '' }] });
  });

  it('trims indentation, which is presentation rather than content', () => {
    const inline = parseXml('<a>x</a>', 'a.xml').value;
    const indented = parseXml('<a>\n  x\n</a>', 'b.xml').value;
    expect(indented).toEqual(inline);
  });

  it('says what it did, in every case — Rule 3', () => {
    const notes = parseXml('<a>x</a>', 'a.xml').notes.join(' ');
    expect(notes).toContain('compared as a list');
    expect(notes).toContain('compared as text');
  });

  it('mentions comments and namespaces when the document has them', () => {
    const commented = parseXml('<!-- note --><a>x</a>', 'a.xml').notes.join(' ');
    expect(commented).toContain('Comments in a.xml are not compared');

    const namespaced = parseXml('<a xmlns:x="urn:x"><x:b>1</x:b></a>', 'a.xml').notes.join(' ');
    expect(namespaced).toContain('Namespace prefixes');
  });

  it('stays quiet about namespaces when there are none', () => {
    expect(parseXml('<a><b>1</b></a>', 'a.xml').notes.join(' ')).not.toContain('Namespace');
  });

  it('locates a malformed document rather than half-parsing it', () => {
    // `XMLParser` is forgiving and would return something for this; the validator
    // is what turns it into an error a human can act on.
    try {
      parseXml('<a><b></a>', 'bad.xml');
      expect.unreachable('should have thrown');
    } catch (cause) {
      expect(cause).toBeInstanceOf(XmlParseError);
      expect((cause as Error).message).toContain('bad.xml is not valid XML');
      expect((cause as XmlParseError).line).toBe(1);
      expect((cause as XmlParseError).column).toBeGreaterThan(0);
    }
  });

  it('treats an empty document as an error, not as an empty comparison', () => {
    expect(() => parseXml('   \n', 'empty.xml')).toThrow(/is empty/);
  });
});

describe('the xml engine', () => {
  it('claims two XMLs and nothing else', () => {
    const xml = { side: 'A', kind: 'xml', name: 'a.xml', size: 0 } as InputRef;
    const code = { side: 'B', kind: 'code', name: 'b.ts', size: 0 } as InputRef;
    expect(xmlEngine.canHandle(xml, { ...xml, side: 'B' })).toBe(true);
    expect(xmlEngine.canHandle(xml, code)).toBe(false);
  });

  it('finds no difference in reformatted XML', async () => {
    const result = await compare(
      '<root><a>1</a><b>2</b></root>',
      '<root>\n  <a>1</a>\n  <b>2</b>\n</root>\n',
    );
    expect(result.summary).toMatchObject({ added: 0, removed: 0, modified: 0 });
    expect(result.engineId).toBe('xml');
  });

  it('reports an attribute change as an attribute row, and counts it', async () => {
    const result = await compare('<item id="a" n="1"/>', '<item id="b" n="1"/>');
    expect(result.summary.modified).toBe(1);
    expect(result.summary.extra?.attributes).toBe(1);

    const rows = changed(result.data.rows);
    expect(rows.some((row) => row.key === '@id')).toBe(true);
    expect(rows.some((row) => row.key === '@n')).toBe(false);
  });

  it('reports an added repeated child as an addition, NOT a type change', async () => {
    // The single most common XML edit, and the whole reason `isArray` is forced.
    const result = await compare(
      '<items><item>a</item></items>',
      '<items><item>a</item><item>b</item></items>',
    );
    expect(result.summary.added).toBe(1);
    expect(result.summary.extra?.['type change']).toBeUndefined();
    expect(result.summary.extra?.['type changes']).toBeUndefined();
  });

  it('treats child order as meaningful, unlike the JSON engine', async () => {
    // `<step>` elements in a different order describe a different process.
    const result = await compare(
      '<steps><step>build</step><step>test</step></steps>',
      '<steps><step>test</step><step>build</step></steps>',
    );
    expect(result.summary.modified).toBeGreaterThan(0);
  });

  it('can be told to ignore child order anyway', async () => {
    const result = await compare(
      '<steps><step>build</step><step>test</step></steps>',
      '<steps><step>test</step><step>build</step></steps>',
      { ...xmlEngine.defaultOptions(), ignoreArrayOrder: true },
    );
    expect(result.summary).toMatchObject({ added: 0, removed: 0, modified: 0 });
  });

  it('sees a namespace prefix change as a change', async () => {
    const result = await compare(
      '<r xmlns:a="urn:x"><a:v>1</a:v></r>',
      '<r xmlns:b="urn:x"><b:v>1</b:v></r>',
    );
    expect(result.summary.added + result.summary.removed + result.summary.modified).toBeGreaterThan(
      0,
    );
  });

  it('offers the text engine when the XML will not parse', async () => {
    await expect(compare('<a><b></a>', '<a><b/></a>')).rejects.toThrow(EngineInputError);
    try {
      await compare('<a><b></a>', '<a><b/></a>');
      expect.unreachable('should have thrown');
    } catch (cause) {
      expect((cause as EngineInputError).fallback).toEqual({
        fallbackEngineId: 'text',
        fallbackLabel: 'Compare as text',
      });
      expect((cause as Error).message).toMatch(/line \d+, column \d+/);
    }
  });

  it('does not repeat the same note once per side', async () => {
    const result = await compare('<a>1</a>', '<a>2</a>');
    expect(new Set(result.normalizationNotes).size).toBe(result.normalizationNotes.length);
  });

  it('needs a filesystem only when the text was not inlined', async () => {
    await expect(
      xmlEngine.compare(
        { side: 'A', kind: 'xml', name: 'a.xml', path: '/tmp/a.xml', size: 10 },
        { side: 'B', kind: 'xml', name: 'b.xml', path: '/tmp/b.xml', size: 10 },
        xmlEngine.defaultOptions(),
        ctx(),
      ),
    ).rejects.toThrow(/No filesystem access/);
  });
});
