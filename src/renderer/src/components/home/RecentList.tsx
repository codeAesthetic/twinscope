import { useEffect } from 'react';
import { Button, FileTypeBadge } from '../primitives';
import { badgeKind, pathLine, SummaryChips } from '../../lib/historyView';
import { useAppStore } from '../../stores/app';
import { useCompareStore } from '../../stores/compare';
import { useHistoryStore, timeAgo } from '../../stores/history';

/** How many fit on the Compare screen without pushing the drop zones up. */
const LIMIT = 5;

/**
 * Recent comparisons (MD §36) — the shortest path back to something you were
 * just looking at. Clicking a row re-reads both inputs and re-runs the stored
 * comparison with its stored options.
 */
export function RecentList() {
  const setView = useAppStore((state) => state.setView);
  const rows = useHistoryStore((state) => state.rows);
  const loaded = useHistoryStore((state) => state.loaded);
  const refresh = useHistoryStore((state) => state.refresh);
  const reopen = useCompareStore((state) => state.reopen);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const recent = rows.slice(0, LIMIT);

  return (
    <section className="dd-recent" data-testid="recent-list" aria-labelledby="recent-heading">
      <div className="dd-recent-head">
        <h2 id="recent-heading">Recent comparisons</h2>
        <Button variant="ghost" size="sm" onClick={() => setView('history')}>
          View all →
        </Button>
      </div>

      {loaded && recent.length === 0 ? (
        <p className="dd-empty" data-testid="recent-empty">
          Nothing yet — your comparisons will appear here.
        </p>
      ) : (
        <ul className="dd-rlist">
          {recent.map((row) => (
            <li key={row.id}>
              <button
                type="button"
                className="dd-ritem"
                data-testid={`recent-${row.id}`}
                onClick={() => void reopen(row)}
              >
                <FileTypeBadge kind={badgeKind(row)} />
                <span className="dd-ritem-col">
                  <span className="dd-ritem-name">{row.title}</span>
                  <span className="dd-ritem-path">{pathLine(row)}</span>
                </span>
                <span className="dd-ritem-chips">
                  <SummaryChips row={row} />
                </span>
                <span className="dd-ritem-ago">{timeAgo(row.openedAt)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
