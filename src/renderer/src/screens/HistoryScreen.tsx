import { useEffect, useMemo, useState } from 'react';
import { Button, FileTypeBadge, SearchInput, Toggle } from '../components/primitives';
import { badgeKind, pathLine, SummaryChips } from '../lib/historyView';
import { useCompareStore } from '../stores/compare';
import { groupByRecency, timeAgo, useHistoryStore } from '../stores/history';

/**
 * History (MD §36) — reopen something you were just looking at.
 *
 * Every row is live: starring, deleting and reopening all round-trip through the
 * database in main, so this screen and Home's recent list can never disagree.
 */
export function HistoryScreen() {
  const [starredOnly, setStarredOnly] = useState(false);
  const [query, setQuery] = useState('');
  const [confirmingClear, setConfirmingClear] = useState(false);

  const rows = useHistoryStore((state) => state.rows);
  const loaded = useHistoryStore((state) => state.loaded);
  const refresh = useHistoryStore((state) => state.refresh);
  const star = useHistoryStore((state) => state.star);
  const remove = useHistoryStore((state) => state.remove);
  const clear = useHistoryStore((state) => state.clear);
  const reopen = useCompareStore((state) => state.reopen);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = rows.filter((row) => {
      if (starredOnly && !row.starred) return false;
      if (needle === '') return true;
      return `${row.title} ${pathLine(row)} ${row.engineId}`.toLowerCase().includes(needle);
    });
    return groupByRecency(filtered);
  }, [rows, starredOnly, query]);

  const empty = loaded && groups.length === 0;

  return (
    <div
      style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}
      data-testid="screen-history"
    >
      <div className="dd-toolbar">
        <Toggle pressed={starredOnly} onChange={setStarredOnly}>
          Starred only
        </Toggle>
        <span className="dd-spacer" />
        <SearchInput
          placeholder="Search history…"
          value={query}
          data-testid="history-search"
          onChange={(event) => setQuery(event.target.value)}
        />
        {confirmingClear ? (
          <>
            <Button variant="ghost" onClick={() => setConfirmingClear(false)}>
              Cancel
            </Button>
            <Button
              data-testid="clear-confirm"
              onClick={() => {
                setConfirmingClear(false);
                void clear();
              }}
            >
              Delete everything
            </Button>
          </>
        ) : (
          <Button
            variant="ghost"
            data-testid="clear-history"
            disabled={rows.length === 0}
            onClick={() => setConfirmingClear(true)}
          >
            Clear history
          </Button>
        )}
      </div>

      <div className="dd-history">
        {empty && (
          <p className="dd-empty" data-testid="history-empty">
            {rows.length === 0
              ? 'No comparisons yet. Run one and it will show up here.'
              : 'Nothing matches those filters.'}
          </p>
        )}

        {groups.map((group) => (
          <section key={group.label} aria-labelledby={`hgroup-${group.label}`}>
            <h2 className="dd-hgroup" id={`hgroup-${group.label}`}>
              {group.label}
            </h2>
            <ul className="dd-hlist">
              {group.rows.map((row) => (
                <li key={row.id}>
                  <div className="dd-hitem-wrap">
                    <button
                      type="button"
                      className="dd-hitem"
                      data-testid={`history-${row.id}`}
                      onClick={() => void reopen(row)}
                    >
                      <span
                        className="dd-hitem-star"
                        // Always a literal string: React drops attributes whose
                        // value is `undefined`, which would make the unstarred
                        // state unaddressable from CSS and tests.
                        data-starred={row.starred ? 'true' : 'false'}
                        aria-hidden="true"
                      >
                        {row.starred ? '★' : '☆'}
                      </span>
                      <FileTypeBadge kind={badgeKind(row)} />
                      <span className="dd-hitem-col">
                        <span className="dd-hitem-name">{row.title}</span>
                        <span className="dd-hitem-path">{pathLine(row)}</span>
                      </span>
                      <span className="dd-hitem-chips">
                        <SummaryChips row={row} />
                      </span>
                      <span className="dd-hitem-ago">{timeAgo(row.openedAt)}</span>
                    </button>

                    {/* Outside the row button: a button inside a button is not
                        valid markup, and the star has to stay keyboard-reachable. */}
                    <span className="dd-hitem-actions">
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={row.starred ? `Unstar ${row.title}` : `Star ${row.title}`}
                        aria-pressed={row.starred}
                        data-testid={`star-${row.id}`}
                        onClick={() => void star(row.id, !row.starred)}
                      >
                        {row.starred ? '★' : '☆'}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Delete ${row.title}`}
                        data-testid={`delete-${row.id}`}
                        onClick={() => void remove(row.id)}
                      >
                        ✕
                      </Button>
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
