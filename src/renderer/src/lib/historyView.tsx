import { Chip } from '../components/primitives';
import type { FileKind } from '../components/primitives';
import type { HistoryRow } from '../../../shared/channels';

/**
 * Shared presentation for a stored comparison: the same badge, path line and
 * summary chips whether it appears in Home's recent list or on the History
 * screen, so the two can never drift.
 */

const BADGE_KIND: Record<string, FileKind> = {
  json: 'json',
  code: 'code',
  yaml: 'json',
  csv: 'md',
  md: 'md',
  image: 'image',
  folder: 'folder',
  text: 'text',
  binary: 'text',
  unknown: 'text',
};

export function badgeKind(row: HistoryRow): FileKind {
  return BADGE_KIND[row.a.kind] ?? 'text';
}

/** `~/dir/before.json ↔ after.json` — enough to tell two similar rows apart. */
export function pathLine(row: HistoryRow): string {
  const left = row.a.path ?? row.a.name;
  const right = row.b.path ?? row.b.name;
  return `${shorten(left)} ↔ ${shorten(right)}`;
}

function shorten(path: string): string {
  const home = /^\/Users\/[^/]+|^\/home\/[^/]+/.exec(path);
  return home === null ? path : `~${path.slice(home[0].length)}`;
}

/**
 * Summary chips, engine-agnostic: the counts first, then whatever the engine
 * put in `extra` — the same contract the workspace strip uses.
 */
export function SummaryChips({ row }: { row: HistoryRow }) {
  const { added, removed, modified, extra } = row.summary;

  return (
    <>
      {added > 0 && <Chip variant="add">＋{added}</Chip>}
      {removed > 0 && <Chip variant="del">－{removed}</Chip>}
      {modified > 0 && <Chip variant="mod">～{modified}</Chip>}
      {added + removed + modified === 0 && <Chip>no changes</Chip>}
      {Object.entries(extra ?? {})
        .slice(0, 1)
        .map(([label, value]) => (
          <Chip key={label} variant="info">
            {value} {label}
          </Chip>
        ))}
    </>
  );
}
