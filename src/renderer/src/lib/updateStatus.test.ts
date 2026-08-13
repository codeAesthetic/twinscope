import { describe, expect, it } from 'vitest';
import { describeUpdate } from './updateStatus';

const NOW = Date.parse('2026-08-13T12:00:00.000Z');
const ago = (ms: number): string => new Date(NOW - ms).toISOString();

describe('describeUpdate', () => {
  it('says why nothing has been checked when the preference is off', () => {
    const text = describeUpdate({ status: 'off', current: '0.3.0' }, NOW);
    expect(text).toContain('No check has been made');
    expect(text).toContain('no network calls');
  });

  it('names both versions when an update exists', () => {
    const text = describeUpdate({ status: 'available', current: '0.3.0', latest: '0.4.0' }, NOW);
    expect(text).toContain('0.4.0');
    expect(text).toContain('0.3.0');
  });

  it('reports a failure as a failure, not as up to date', () => {
    const text = describeUpdate(
      { status: 'error', current: '0.3.0', message: 'the update feed answered 503' },
      NOW,
    );
    expect(text).toContain('Could not check');
    expect(text).toContain('503');
  });

  it('scales the "checked" suffix from just now to days', () => {
    const at = (ms: number): string =>
      describeUpdate({ status: 'current', current: '0.3.0', checkedAt: ago(ms) }, NOW);

    expect(at(5_000)).toContain('checked just now');
    expect(at(60_000)).toContain('checked a minute ago');
    expect(at(20 * 60_000)).toContain('checked 20 minutes ago');
    expect(at(60 * 60_000)).toContain('checked an hour ago');
    expect(at(5 * 60 * 60_000)).toContain('checked 5 hours ago');
    expect(at(26 * 60 * 60_000)).toContain('checked yesterday');
    expect(at(3 * 24 * 60 * 60_000)).toContain('checked 3 days ago');
  });

  it('omits the suffix when no check has completed', () => {
    expect(describeUpdate({ status: 'current', current: '0.3.0' }, NOW)).toBe(
      'Up to date — 0.3.0.',
    );
  });

  it('survives a checkedAt it cannot parse', () => {
    const text = describeUpdate({ status: 'current', current: '0.3.0', checkedAt: 'soon' }, NOW);
    expect(text).toBe('Up to date — 0.3.0.');
  });
});
