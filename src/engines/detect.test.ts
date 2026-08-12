import { describe, expect, it } from 'vitest';
import { detectKind, extensionOf, languageOf, looksBinary } from './detect';
import { selectEngine, selectEngineForInputs } from './registry';
import type { InputKind, InputRef } from './types';

const ref = (name: string, extra: Partial<InputRef> = {}): InputRef => ({
  side: 'A',
  kind: 'unknown',
  name,
  size: 0,
  ...extra,
});

describe('detectKind — by extension', () => {
  const cases: Array<[string, InputKind]> = [
    ['users.json', 'json'],
    ['response.har', 'json'],
    ['config.yaml', 'yaml'],
    ['config.yml', 'yaml'],
    ['rows.csv', 'csv'],
    ['rows.tsv', 'csv'],
    ['README.md', 'md'],
    ['notes.txt', 'text'],
    ['server.log', 'text'],
    ['screenshot.png', 'image'],
    ['photo.JPEG', 'image'],
    ['icon.webp', 'image'],
    ['client.ts', 'code'],
    ['App.tsx', 'code'],
    ['script.py', 'code'],
    ['schema.sql', 'code'],
    ['styles.scss', 'code'],
    ['main.rs', 'code'],
  ];

  it.each(cases)('%s → %s', (name, expected) => {
    expect(detectKind(ref(name))).toBe(expected);
  });

  it('is case-insensitive about extensions', () => {
    expect(detectKind(ref('DATA.JSON'))).toBe('json');
  });

  it('ignores directories in the path when reading the extension', () => {
    expect(extensionOf('src/api/client.ts')).toBe('ts');
  });

  it('treats a dotfile as having no extension', () => {
    expect(extensionOf('.gitignore')).toBe('');
  });
});

describe('detectKind — by content', () => {
  it('recognises JSON with no useful filename', () => {
    expect(detectKind(ref('clipboard-A', { text: '{"user": {"id": 1}}' }))).toBe('json');
  });

  it('recognises a JSON array', () => {
    expect(detectKind(ref('pasted', { text: '[1, 2, 3]' }))).toBe('json');
  });

  it('does not mistake JSON-ish prose for JSON', () => {
    expect(detectKind(ref('pasted', { text: '{ this is not json' }))).toBe('text');
  });

  it('falls back to text for anything else', () => {
    expect(detectKind(ref('pasted', { text: 'just some words' }))).toBe('text');
  });

  it('detects binary via a NUL byte', () => {
    expect(detectKind(ref('mystery', { text: 'PK\0\0binary' }))).toBe('binary');
    expect(looksBinary('plain text')).toBe(false);
  });

  it('keeps folders structural rather than sniffing them', () => {
    expect(detectKind(ref('project/', { kind: 'folder' }))).toBe('folder');
  });

  it('is unknown when there is nothing to go on', () => {
    expect(detectKind(ref('mystery'))).toBe('unknown');
  });
});

describe('languageOf', () => {
  it('maps code extensions to highlighter languages', () => {
    expect(languageOf('client.ts')).toBe('typescript');
    expect(languageOf('main.py')).toBe('python');
    expect(languageOf('notes.txt')).toBeUndefined();
  });
});

describe('selectEngine', () => {
  const pick = (aKind: InputKind, bKind: InputKind): string | undefined =>
    selectEngine(ref('a', { kind: aKind }), ref('b', { kind: bKind, side: 'B' }))?.meta.id;

  it('routes matching kinds to their specialised engine', () => {
    expect(pick('json', 'json')).toBe('json');
    expect(pick('image', 'image')).toBe('image');
    expect(pick('folder', 'folder')).toBe('folder');
    expect(pick('code', 'code')).toBe('text');
  });

  it('falls back to text when the two sides disagree', () => {
    expect(pick('json', 'yaml')).toBe('text');
    expect(pick('csv', 'md')).toBe('text');
  });

  it('has no engine for a folder against a file', () => {
    expect(pick('folder', 'json')).toBeUndefined();
  });

  it('routes a binary pair to the binary engine, not to text (MVP-11)', () => {
    // Line-diffing a compiled binary produces mojibake and answers nothing.
    expect(pick('binary', 'binary')).toBe('binary');
  });

  it('prefers the specialised engine over the text fallback', () => {
    // Both json and text can handle a json pair; priority decides.
    expect(pick('json', 'json')).toBe('json');
  });
});

describe('selectEngineForInputs', () => {
  it('detects and selects in one step', () => {
    const result = selectEngineForInputs(
      { name: 'a.json', text: '{"a":1}', kind: 'unknown' },
      { name: 'b.json', text: '{"a":2}', kind: 'unknown' },
    );
    expect(result.kinds).toEqual(['json', 'json']);
    expect(result.engine?.meta.id).toBe('json');
  });

  it('picks text for a mixed pair and still returns both kinds', () => {
    const result = selectEngineForInputs(
      { name: 'a.json', kind: 'unknown', text: '{}' },
      { name: 'b.md', kind: 'unknown', text: '# hi' },
    );
    expect(result.kinds).toEqual(['json', 'md']);
    expect(result.engine?.meta.id).toBe('text');
  });
});

describe('the engine catalog', () => {
  it('covers every MVP engine, each claiming its own kind', () => {
    const claims = (kind: InputKind): string | undefined =>
      selectEngine(ref('a', { kind }), ref('b', { kind, side: 'B' }))?.meta.id;

    expect(claims('folder')).toBe('folder');
    expect(claims('image')).toBe('image');
    expect(claims('json')).toBe('json');
    expect(claims('text')).toBe('text');
  });

  it('hands out a fresh options object each time, so callers cannot mutate defaults', () => {
    const engine = selectEngine(
      ref('a.png', { kind: 'image' }),
      ref('b.png', { kind: 'image', side: 'B' }),
    );
    expect(engine?.defaultOptions()).not.toBe(engine?.defaultOptions());
  });
});
