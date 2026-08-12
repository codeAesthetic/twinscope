import { create } from 'zustand';
import type { HistoryRow } from '../../../shared/channels';

/**
 * Comparison history, mirrored from main (MD §36).
 *
 * The database is the source of truth and every mutation round-trips through it
 * — a local optimistic copy would drift the moment two surfaces (Home's recent
 * list and the History screen) disagreed about a star.
 */
interface HistoryState {
  rows: HistoryRow[];
  loaded: boolean;

  refresh: () => Promise<void>;
  star: (id: number, starred: boolean) => Promise<void>;
  remove: (id: number) => Promise<void>;
  clear: () => Promise<void>;
}

export const useHistoryStore = create<HistoryState>((set, get) => ({
  rows: [],
  loaded: false,

  refresh: async () => {
    const rows = await window.twinscope.history.list({});
    set({ rows, loaded: true });
  },

  star: async (id, starred) => {
    await window.twinscope.history.star(id, starred);
    await get().refresh();
  },

  remove: async (id) => {
    await window.twinscope.history.remove(id);
    await get().refresh();
  },

  clear: async () => {
    await window.twinscope.history.clear();
    await get().refresh();
  },
}));

/**
 * Buckets for the History screen. Grouping by recency rather than by date is
 * what makes "the thing I was just looking at" the first thing on screen.
 */
export type HistoryGroupLabel = 'Today' | 'Yesterday' | 'This week' | 'Earlier';

export function groupByRecency(
  rows: readonly HistoryRow[],
  now = new Date(),
): Array<{ label: HistoryGroupLabel; rows: HistoryRow[] }> {
  const groups: Array<{ label: HistoryGroupLabel; rows: HistoryRow[] }> = [
    { label: 'Today', rows: [] },
    { label: 'Yesterday', rows: [] },
    { label: 'This week', rows: [] },
    { label: 'Earlier', rows: [] },
  ];

  for (const row of rows) {
    const days = daysAgo(parseUtc(row.openedAt), now);
    const group =
      days < 1 ? groups[0] : days < 2 ? groups[1] : days < 7 ? groups[2] : (groups[3] as never);
    group?.rows.push(row);
  }

  return groups.filter((group) => group.rows.length > 0);
}

/** SQLite writes UTC without a zone marker; `Date` would read it as local. */
export function parseUtc(stamp: string): Date {
  return new Date(`${stamp.replace(' ', 'T')}Z`);
}

function daysAgo(then: Date, now: Date): number {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfThen = new Date(then.getFullYear(), then.getMonth(), then.getDate());
  return Math.round((startOfToday.getTime() - startOfThen.getTime()) / 86_400_000);
}

/** "2 min ago" — relative time is what a history list is actually asked for. */
export function timeAgo(stamp: string, now = new Date()): string {
  const seconds = Math.max(0, (now.getTime() - parseUtc(stamp).getTime()) / 1000);
  if (seconds < 60) return 'just now';

  const units: Array<[number, string]> = [
    [60, 'min'],
    [3600, 'hour'],
    [86_400, 'day'],
    [604_800, 'week'],
  ];

  let label = 'min';
  let value = seconds / 60;
  for (const [size, name] of units) {
    if (seconds < size) break;
    value = seconds / size;
    label = name;
  }

  const rounded = Math.floor(value);
  return `${rounded} ${label}${rounded === 1 ? '' : 's'} ago`;
}
