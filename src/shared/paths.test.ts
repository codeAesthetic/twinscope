import { describe, expect, it } from 'vitest';
import { isInside, normalisePath } from './paths';

describe('normalisePath', () => {
  it('canonicalises a path that traverses', () => {
    expect(normalisePath('/tmp/a/../b/./c')).toBe('/tmp/b/c');
  });

  it('collapses duplicate separators', () => {
    expect(normalisePath('/tmp//a///b')).toBe('/tmp/a/b');
  });

  it('rejects a NUL byte', () => {
    // libuv truncates at the NUL, so this would be checked as one path and
    // opened as another — the classic poison-null-byte bypass.
    expect(() => normalisePath('/tmp/safe\0/../../etc/passwd')).toThrow(/null byte/i);
  });

  it('rejects a relative path', () => {
    expect(() => normalisePath('../../etc/passwd')).toThrow(/absolute/i);
    expect(() => normalisePath('etc/passwd')).toThrow(/absolute/i);
  });

  it('rejects an empty or blank path', () => {
    expect(() => normalisePath('')).toThrow();
    expect(() => normalisePath('   ')).toThrow();
  });

  it('leaves an already-canonical path alone', () => {
    expect(normalisePath('/tmp/a/b')).toBe('/tmp/a/b');
  });
});

describe('isInside', () => {
  it('accepts the root itself and anything beneath it', () => {
    expect(isInside('/tmp/project', '/tmp/project')).toBe(true);
    expect(isInside('/tmp/project', '/tmp/project/src/index.ts')).toBe(true);
  });

  it('rejects a sibling that merely shares a prefix', () => {
    // The bug this exists to avoid: a plain startsWith() says yes to both.
    expect(isInside('/tmp/project', '/tmp/project-secrets/key')).toBe(false);
    expect(isInside('/home/user', '/home/user-backup')).toBe(false);
  });

  it('rejects a parent and an unrelated path', () => {
    expect(isInside('/tmp/project', '/tmp')).toBe(false);
    expect(isInside('/tmp/project', '/etc/passwd')).toBe(false);
  });

  it('resolves traversal before deciding', () => {
    expect(isInside('/tmp/project', '/tmp/project/../../etc/passwd')).toBe(false);
    expect(isInside('/tmp/project', '/tmp/project/sub/../ok.txt')).toBe(true);
  });

  it('tolerates a trailing separator on the root', () => {
    expect(isInside('/tmp/project/', '/tmp/project/file')).toBe(true);
  });
});
