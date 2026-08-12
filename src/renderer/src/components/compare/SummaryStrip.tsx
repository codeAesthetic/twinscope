import type { ReactNode } from 'react';
import { Chip } from '../primitives';
import { useChangeNavStore } from '../../stores/changeNav';
import type { Summary } from '../../../../shared/channels';

/**
 * Every comparison opens with a human-readable summary (MD §12) — the counts
 * first, the raw diff second.
 *
 * `summary.extra` is rendered verbatim, which is how each engine adds its own
 * vocabulary (diff %, identical files, type changes) without this component
 * knowing anything about engines.
 */
export function SummaryStrip({ summary, right }: { summary: Summary; right?: ReactNode }) {
  const total = summary.added + summary.removed + summary.modified;

  return (
    <div className="dd-sumstrip" data-testid="summary-strip">
      <span className="dd-sumstrip-total">
        {total} change{total === 1 ? '' : 's'}
      </span>
      <Chip variant="add">＋{summary.added} added</Chip>
      <Chip variant="del">－{summary.removed} removed</Chip>
      <Chip variant="mod">～{summary.modified} modified</Chip>

      {Object.entries(summary.extra ?? {}).map(([label, value]) => (
        <Chip key={label} variant="info">
          {value} {label}
        </Chip>
      ))}

      {summary.suppressed !== undefined && summary.suppressed > 0 && (
        // Rule 3: normalization that hid differences has to say so.
        <Chip>{summary.suppressed} suppressed</Chip>
      )}

      <ChangeNav />
      <span className="dd-spacer" />
      {right}
    </div>
  );
}

/**
 * ‹ n/total › stepper, driven by the shared change-nav store so it can never
 * disagree with the engine view or the ⌥↑/⌥↓ shortcuts.
 */
export function ChangeNav() {
  const count = useChangeNavStore((state) => state.count);
  const current = useChangeNavStore((state) => state.current);
  const next = useChangeNavStore((state) => state.next);
  const previous = useChangeNavStore((state) => state.previous);

  if (count === 0) return null;

  return (
    <div className="dd-navchg" data-testid="change-nav">
      <button type="button" aria-label="Previous change" onClick={previous}>
        ‹
      </button>
      <span data-testid="change-position">
        {current === -1 ? '–' : current + 1} / {count}
      </span>
      <button type="button" aria-label="Next change" onClick={next}>
        ›
      </button>
    </div>
  );
}
