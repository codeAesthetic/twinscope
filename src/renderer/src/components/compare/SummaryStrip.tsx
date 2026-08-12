import type { ReactNode } from 'react';
import { Chip } from '../primitives';

export interface ChangeCounts {
  added: number;
  removed: number;
  modified: number;
}

/**
 * Every comparison opens with a human-readable summary (MD §12) — the counts
 * come first, the raw diff second.
 *
 * Engine-specific extras (diff %, identical files, type changes) arrive via
 * `extras` so each engine can add its own vocabulary without a new component.
 */
export function SummaryStrip({
  counts,
  extras,
  navigation,
  right,
}: {
  counts: ChangeCounts;
  extras?: ReactNode;
  navigation?: ReactNode;
  right?: ReactNode;
}) {
  const total = counts.added + counts.removed + counts.modified;

  return (
    <div className="dd-sumstrip" data-testid="summary-strip">
      <span className="dd-sumstrip-total">
        {total} change{total === 1 ? '' : 's'}
      </span>
      <Chip variant="add">＋{counts.added} added</Chip>
      <Chip variant="del">－{counts.removed} removed</Chip>
      <Chip variant="mod">～{counts.modified} modified</Chip>
      {extras}
      {navigation}
      <span className="dd-spacer" />
      {right}
    </div>
  );
}

/**
 * ‹ n/total › stepper. Static here; MVP-3 drives it from each engine view's
 * change index and binds it to ⌥↑/⌥↓.
 */
export function ChangeNav({ index, total }: { index: number; total: number }) {
  return (
    <div className="dd-navchg" data-testid="change-nav">
      <button type="button" aria-label="Previous change" title="Wired up in MVP-3">
        ‹
      </button>
      <span>
        {index} / {total}
      </span>
      <button type="button" aria-label="Next change" title="Wired up in MVP-3">
        ›
      </button>
    </div>
  );
}
