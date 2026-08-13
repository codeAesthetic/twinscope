import { describe, expect, it } from 'vitest';
import { buildCompareLink, parseCompareLink } from './deepLink';

describe('parseCompareLink', () => {
  it('accepts a well-formed link', () => {
    expect(parseCompareLink('twinscope://compare?a=%2Ftmp%2Fa.json&b=%2Ftmp%2Fb.json')).toEqual({
      a: '/tmp/a.json',
      b: '/tmp/b.json',
    });
  });

  it('accepts the three-slash form some launchers produce', () => {
    expect(parseCompareLink('twinscope:///compare?a=%2Ftmp%2Fa&b=%2Ftmp%2Fb')).toEqual({
      a: '/tmp/a',
      b: '/tmp/b',
    });
  });

  it('accepts an engine slug and refuses anything else in that field', () => {
    expect(parseCompareLink('twinscope://compare?a=%2Fa&b=%2Fb&engine=json')?.engine).toBe('json');
    expect(parseCompareLink('twinscope://compare?a=%2Fa&b=%2Fb&engine=../../etc')).toBeNull();
  });

  it('refuses another scheme, another action, and a missing side', () => {
    expect(parseCompareLink('https://compare?a=%2Fa&b=%2Fb')).toBeNull();
    expect(parseCompareLink('twinscope://run?a=%2Fa&b=%2Fb')).toBeNull();
    expect(parseCompareLink('twinscope://compare?a=%2Fa')).toBeNull();
    expect(parseCompareLink('not a url at all')).toBeNull();
  });

  it('refuses a relative path', () => {
    // Resolving it would mean "compare ./secrets" depending on how the app was
    // launched — the one thing a link from an unknown source must not decide.
    expect(parseCompareLink('twinscope://compare?a=a.json&b=%2Ftmp%2Fb.json')).toBeNull();
    expect(
      parseCompareLink('twinscope://compare?a=..%2F..%2Fetc%2Fpasswd&b=%2Ftmp%2Fb'),
    ).toBeNull();
  });

  it('refuses a NUL, which truncates inside libuv', () => {
    expect(parseCompareLink('twinscope://compare?a=%2Ftmp%2Fa%00.png&b=%2Ftmp%2Fb')).toBeNull();
  });

  it('accepts Windows and UNC paths', () => {
    expect(parseCompareLink('twinscope://compare?a=C%3A%5Ca.txt&b=C%3A%5Cb.txt')?.a).toBe(
      'C:\\a.txt',
    );
    expect(
      parseCompareLink('twinscope://compare?a=%5C%5Chost%5Cshare%5Ca&b=%5C%5Chost%5Cshare%5Cb')?.a,
    ).toBe('\\\\host\\share\\a');
  });

  it('bounds the path length', () => {
    const long = `/${'x'.repeat(5000)}`;
    expect(parseCompareLink(buildCompareLink({ a: long, b: '/tmp/b' }))).toBeNull();
  });
});

describe('buildCompareLink', () => {
  it('round-trips through the parser, spaces and all', () => {
    const link = { a: '/tmp/my files/a b.json', b: '/tmp/other & thing.json', engine: 'json' };
    expect(parseCompareLink(buildCompareLink(link))).toEqual(link);
  });

  it('produces the shape the VS Code extension hand-builds', () => {
    // `integrations/vscode/extension.js` cannot import this module — separate
    // runtime, no build step — so it builds the URL itself. This is the assertion
    // that the two agree; change one and this fails.
    const a = '/work/repo/before.ts';
    const b = '/work/repo/after.ts';
    const extensionForm = `twinscope://compare?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`;
    expect(parseCompareLink(extensionForm)).toEqual({ a, b });
    expect(buildCompareLink({ a, b })).toBe(extensionForm);
  });
});
