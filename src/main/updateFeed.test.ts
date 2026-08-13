import { describe, expect, it } from 'vitest';
import { isNewer, latestFromFeed, parseVersion } from './updateFeed';

describe('parseVersion', () => {
  it('accepts three numbers, with or without the tag prefix', () => {
    expect(parseVersion('0.3.0')).toEqual([0, 3, 0]);
    expect(parseVersion('v1.20.300')).toEqual([1, 20, 300]);
    expect(parseVersion('  v0.1.0  ')).toEqual([0, 1, 0]);
  });

  it('rejects anything that is not exactly a version', () => {
    // Deliberately narrow: this string comes off the network, and a parser that
    // is generous here is one that hands the UI something to render blindly.
    for (const raw of [
      '0.3',
      '0.3.0.1',
      '0.3.0-beta.1',
      '0.3.0+build',
      'v0.3.x',
      'javascript:alert(1)',
      'https://example.com/0.3.0',
      '',
      '99999999999999999999.0.0',
    ]) {
      expect(parseVersion(raw), raw).toBeNull();
    }
  });
});

describe('isNewer', () => {
  it('compares numerically, not lexically', () => {
    // The bug this rules out: '0.10.0' < '0.9.0' as strings.
    expect(isNewer('0.10.0', '0.9.0')).toBe(true);
    expect(isNewer('0.9.0', '0.10.0')).toBe(false);
  });

  it('is false for the same version, and for a downgrade', () => {
    expect(isNewer('0.3.0', '0.3.0')).toBe(false);
    expect(isNewer('0.2.14', '0.3.0')).toBe(false);
  });

  it('walks the components in order', () => {
    expect(isNewer('1.0.0', '0.99.99')).toBe(true);
    expect(isNewer('0.3.1', '0.3.0')).toBe(true);
    expect(isNewer('0.3.0', '0.3.1')).toBe(false);
  });

  it('is false when either side is unparseable, never a guess', () => {
    expect(isNewer('nightly', '0.3.0')).toBe(false);
    expect(isNewer('0.4.0', 'nightly')).toBe(false);
  });
});

describe('latestFromFeed', () => {
  it('reads tag_name and drops the v', () => {
    expect(latestFromFeed(JSON.stringify({ tag_name: 'v0.3.0' }))).toBe('0.3.0');
  });

  it('ignores a draft or a prerelease', () => {
    // `/releases/latest` excludes both already; trusting the contract instead of
    // the payload is how an unfinished release gets announced to every user.
    expect(latestFromFeed(JSON.stringify({ tag_name: 'v0.4.0', draft: true }))).toBeNull();
    expect(latestFromFeed(JSON.stringify({ tag_name: 'v0.4.0', prerelease: true }))).toBeNull();
  });

  it('returns null for anything that is not a release document', () => {
    for (const body of [
      '',
      'not json',
      'null',
      '[]',
      '"0.4.0"',
      JSON.stringify({ tag_name: 42 }),
      JSON.stringify({ tag_name: 'nightly' }),
      JSON.stringify({ name: '0.4.0' }),
    ]) {
      expect(latestFromFeed(body), body).toBeNull();
    }
  });

  it('takes nothing but the version from the document', () => {
    // Everything else in a real release document is ignored on purpose — most of
    // all `html_url`, which is why the release page is a constant in update.ts.
    const body = JSON.stringify({
      tag_name: 'v0.4.0',
      html_url: 'https://example.invalid/malicious',
      body: '<script>alert(1)</script>',
      assets: [{ browser_download_url: 'https://example.invalid/payload.dmg' }],
    });
    expect(latestFromFeed(body)).toBe('0.4.0');
  });
});
