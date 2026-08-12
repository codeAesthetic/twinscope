import { describe, expect, it } from 'vitest';
import { groupByRecency, parseUtc, timeAgo } from './history';
import type { HistoryRow } from '../../../shared/channels';

/** SQLite stores UTC without a zone marker; these fixtures match that shape. */
const NOW = new Date('2026-08-12T12:00:00Z');

function row(openedAt: string, id = 1): HistoryRow {
  return {
    id,
    title: 'a ↔ b',
    engineId: 'text',
    a: { kind: 'text', name: 'a', size: 1 },
    b: { kind: 'text', name: 'b', size: 1 },
    options: {},
    summary: { added: 0, removed: 0, modified: 1 },
    starred: false,
    createdAt: openedAt,
    openedAt,
  };
}

describe('parseUtc', () => {
  it('reads a SQLite timestamp as UTC, not local time', () => {
    // Without the Z this would shift by the machine's offset, and a comparison
    // run this morning would land in "Yesterday" for anyone west of Greenwich.
    expect(parseUtc('2026-08-12 09:30:00').toISOString()).toBe('2026-08-12T09:30:00.000Z');
  });
});

describe('timeAgo', () => {
  it('says "just now" under a minute', () => {
    expect(timeAgo('2026-08-12 11:59:30', NOW)).toBe('just now');
  });

  it('counts minutes, hours, days and weeks', () => {
    expect(timeAgo('2026-08-12 11:58:00', NOW)).toBe('2 mins ago');
    expect(timeAgo('2026-08-12 09:00:00', NOW)).toBe('3 hours ago');
    expect(timeAgo('2026-08-09 12:00:00', NOW)).toBe('3 days ago');
    expect(timeAgo('2026-07-20 12:00:00', NOW)).toBe('3 weeks ago');
  });

  it('uses the singular for exactly one', () => {
    expect(timeAgo('2026-08-12 11:00:00', NOW)).toBe('1 hour ago');
  });

  it('never reports a negative age from a clock skew', () => {
    expect(timeAgo('2026-08-12 12:05:00', NOW)).toBe('just now');
  });
});

/**
 * Grouping is by *local* calendar day, so fixtures are built by walking back
 * from local midnight rather than hard-coded — otherwise this test passes in
 * one timezone and fails in another.
 */
function utcStamp(date: Date): string {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function localMidnight(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe('groupByRecency', () => {
  it('buckets by calendar day, not by elapsed hours', () => {
    const midnight = localMidnight(NOW).getTime();
    const groups = groupByRecency(
      [
        row(utcStamp(new Date(midnight + 2 * HOUR)), 1),
        row(utcStamp(new Date(midnight - 2 * HOUR)), 2),
        row(utcStamp(new Date(midnight - 3 * DAY)), 3),
        row(utcStamp(new Date(midnight - 60 * DAY)), 4),
      ],
      NOW,
    );

    expect(groups.map((group) => group.label)).toEqual([
      'Today',
      'Yesterday',
      'This week',
      'Earlier',
    ]);
    expect(groups[0]?.rows.map((entry) => entry.id)).toEqual([1]);
    expect(groups[1]?.rows.map((entry) => entry.id)).toEqual([2]);
  });

  it('drops empty groups instead of rendering empty headings', () => {
    const groups = groupByRecency(
      [row(utcStamp(new Date(localMidnight(NOW).getTime() + HOUR)))],
      NOW,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]?.label).toBe('Today');
  });

  it('returns nothing at all for an empty history', () => {
    expect(groupByRecency([], NOW)).toEqual([]);
  });
});
