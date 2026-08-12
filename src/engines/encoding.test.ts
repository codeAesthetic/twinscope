import { describe, expect, it } from 'vitest';
import { decodeText, detectEncoding, detectEol, looksBinaryText } from './encoding';
import { binaryEngine, formatBytes } from './binary';
import { textEngine } from './text';
import type { EngineCtx, HostFs, InputRef } from './types';

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

function utf16(text: string, littleEndian: boolean, bom = true): Uint8Array {
  const bytes = new Uint8Array((text.length + (bom ? 1 : 0)) * 2);
  const view = new DataView(bytes.buffer);
  let at = 0;
  if (bom) {
    view.setUint16(0, 0xfeff, littleEndian);
    at = 2;
  }
  for (let index = 0; index < text.length; index += 1) {
    view.setUint16(at + index * 2, text.charCodeAt(index), littleEndian);
  }
  return bytes;
}

describe('detectEncoding', () => {
  it('takes a byte-order mark at its word', () => {
    expect(detectEncoding(new Uint8Array([0xef, 0xbb, 0xbf, 0x61]))).toBe('utf-8-bom');
    expect(detectEncoding(new Uint8Array([0xff, 0xfe, 0x61, 0x00]))).toBe('utf-16le');
    expect(detectEncoding(new Uint8Array([0xfe, 0xff, 0x00, 0x61]))).toBe('utf-16be');
  });

  it('spots UTF-16 without a mark from its alternating NULs', () => {
    const long = 'hello world, this is long enough to establish a pattern';
    expect(detectEncoding(utf16(long, true, false))).toBe('utf-16le');
    expect(detectEncoding(utf16(long, false, false))).toBe('utf-16be');
  });

  it('does not mistake a few binary bytes for UTF-16', () => {
    // A short header with NULs in even positions used to read as UTF-16 BE, and
    // an executable would then be line-diffed as text.
    expect(detectEncoding(new Uint8Array([0, 1, 2, 3, 0, 255]))).toBe('utf-8');
  });

  it('leaves ordinary text alone', () => {
    expect(detectEncoding(utf8('const value = 1;\n'))).toBe('utf-8');
  });
});

describe('decodeText', () => {
  it('strips a UTF-8 mark rather than leaving it on line 1', () => {
    const decoded = decodeText(new Uint8Array([0xef, 0xbb, 0xbf, ...utf8('hello')]));
    expect(decoded.text).toBe('hello');
    expect(decoded.encoding).toBe('utf-8-bom');
    // An invisible first character would make two identical files differ.
    expect(decoded.text.charCodeAt(0)).toBe('h'.charCodeAt(0));
  });

  it('reads UTF-16 as text instead of as a wall of NULs', () => {
    const decoded = decodeText(utf16('héllo', true));
    expect(decoded.text).toBe('héllo');
    expect(looksBinaryText(decoded.text)).toBe(false);
  });

  it('falls back to latin1 and says it was lossy', () => {
    // 0xff is not valid UTF-8 anywhere.
    const decoded = decodeText(new Uint8Array([0x61, 0xff, 0x62]));
    expect(decoded.lossy).toBe(true);
    expect(decoded.encoding).toBe('latin1');
    expect(decoded.text).toHaveLength(3);
  });

  it('handles an empty file without inventing content', () => {
    const decoded = decodeText(new Uint8Array());
    expect(decoded.text).toBe('');
    expect(decoded.eol).toBe('none');
  });
});

describe('detectEol', () => {
  it('names the ending actually used', () => {
    expect(detectEol('a\nb')).toBe('LF');
    expect(detectEol('a\r\nb')).toBe('CRLF');
    expect(detectEol('a\rb')).toBe('CR');
    expect(detectEol('no endings')).toBe('none');
  });

  it('reports CRLF for a mixed file, which is the surprising half', () => {
    expect(detectEol('a\r\nb\nc')).toBe('CRLF');
  });
});

describe('textEngine identical fast path', () => {
  const ctx = (): EngineCtx => ({
    signal: new AbortController().signal,
    progress: () => undefined,
  });
  const ref = (side: 'A' | 'B', text: string): InputRef => ({
    side,
    kind: 'text',
    name: `${side}.txt`,
    text,
    size: text.length,
  });

  it('answers immediately when both sides match', async () => {
    const result = await textEngine.compare(
      ref('A', 'one\ntwo\n'),
      ref('B', 'one\ntwo\n'),
      textEngine.defaultOptions(),
      ctx(),
    );

    expect(result.summary).toMatchObject({ added: 0, removed: 0, modified: 0 });
    expect(result.data.rows).toEqual([]);
    expect(result.normalizationNotes.join(' ')).toContain('identical');
  });

  it('says so when both sides are empty, rather than showing a blank diff', async () => {
    const result = await textEngine.compare(
      ref('A', ''),
      ref('B', ''),
      textEngine.defaultOptions(),
      ctx(),
    );
    expect(result.normalizationNotes.join(' ')).toContain('empty');
  });
});

describe('binaryEngine', () => {
  const hashes: Record<string, string> = { '/a.bin': 'aaa', '/b.bin': 'bbb' };
  const fs = (): HostFs => ({
    readText: () => Promise.reject(new Error('no')),
    readBytes: () => Promise.reject(new Error('no')),
    listDir: () => Promise.reject(new Error('no')),
    stat: () => Promise.reject(new Error('no')),
    hashFile: (path) => Promise.resolve(hashes[path] ?? 'zzz'),
  });
  const ctx = (): EngineCtx => ({
    signal: new AbortController().signal,
    progress: () => undefined,
    fs: fs(),
  });
  const ref = (side: 'A' | 'B', path: string, size: number): InputRef => ({
    side,
    kind: 'binary',
    name: path.slice(1),
    path,
    size,
  });

  it('outranks every other engine for a binary pair', () => {
    expect(binaryEngine.canHandle(ref('A', '/a.bin', 1), ref('B', '/b.bin', 1))).toBe(true);
    expect(binaryEngine.meta.priority).toBeGreaterThan(50);
  });

  it('calls a size difference conclusive without hashing', async () => {
    let hashed = 0;
    const result = await binaryEngine.compare(
      ref('A', '/a.bin', 100),
      ref('B', '/b.bin', 200),
      binaryEngine.defaultOptions(),
      {
        ...ctx(),
        fs: {
          ...fs(),
          hashFile: (path) => {
            hashed += 1;
            return Promise.resolve(hashes[path] ?? 'zzz');
          },
        },
      },
    );

    expect(hashed).toBe(0);
    expect(result.data.identical).toBe(false);
    expect(result.data.sizeDelta).toBe(100);
    expect(result.summary.extra?.verdict).toBe('different');
  });

  it('hashes when the sizes match, and reports identical only then', async () => {
    const different = await binaryEngine.compare(
      ref('A', '/a.bin', 100),
      ref('B', '/b.bin', 100),
      binaryEngine.defaultOptions(),
      ctx(),
    );
    expect(different.data.identical).toBe(false);
    expect(different.data.before.hash).toBe('aaa');

    const same = await binaryEngine.compare(
      ref('A', '/a.bin', 100),
      ref('B', '/a.bin', 100),
      binaryEngine.defaultOptions(),
      ctx(),
    );
    expect(same.data.identical).toBe(true);
    expect(same.summary.modified).toBe(0);
    expect(same.normalizationNotes.join(' ')).toContain('byte-for-byte');
  });

  it('says when it did not read the content', async () => {
    const result = await binaryEngine.compare(
      ref('A', '/a.bin', 100),
      ref('B', '/b.bin', 100),
      { compareContentHash: false },
      ctx(),
    );
    expect(result.normalizationNotes.join(' ')).toContain('turned off');
    expect(result.data.before.hash).toBeUndefined();
  });
});

describe('formatBytes', () => {
  it('reads at the scale of the number', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(formatBytes(-2048)).toBe('−2.0 KB');
  });
});
