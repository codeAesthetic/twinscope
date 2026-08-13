import { useEffect, useMemo, useState } from 'react';
import { Button, FileTypeBadge, Seg, SearchInput, Toggle } from '../components/primitives';
import { badgeKind, pathLine, SummaryChips } from '../lib/historyView';
import { useCompareStore } from '../stores/compare';
import { groupByRecency, timeAgo, useHistoryStore } from '../stores/history';
import { useProjectsStore } from '../stores/projects';
import { SavedList } from './ProjectsScreen';

/**
 * History (MD §36) — reopen something you were just looking at.
 *
 * Every row is live: starring, deleting and reopening all round-trip through the
 * database in main, so this screen and Home's recent list can never disagree.
 */
export function HistoryScreen() {
  /**
   * Recent versus saved (v0.2.9). Two different things in one place on purpose:
   * both answer "take me back to that comparison", and the saved ones are the
   * subset you said were worth keeping.
   */
  const [tab, setTab] = useState<'recent' | 'saved'>('recent');
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
  const saved = useProjectsStore((state) => state.saved);
  const projects = useProjectsStore((state) => state.projects);
  const refreshProjects = useProjectsStore((state) => state.refresh);

  useEffect(() => {
    void refresh();
    void refreshProjects();
  }, [refresh, refreshProjects]);

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
        <Seg
          label="History tab"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'recent', label: 'Recent' },
            { value: 'saved', label: `Saved${saved.length > 0 ? ` (${saved.length})` : ''}` },
          ]}
        />
        {/* Starring is a property of a *history* row, so the toggle belongs to that
            tab and is simply absent from the other one — a disabled control here
            would be a control that never becomes usable. */}
        {tab === 'recent' && (
          <Toggle pressed={starredOnly} onChange={setStarredOnly}>
            Starred only
          </Toggle>
        )}
        <span className="dd-spacer" />
        <SearchInput
          placeholder="Search history…"
          value={query}
          data-testid="history-search"
          onChange={(event) => setQuery(event.target.value)}
        />
        {/* Clearing history has nothing to do with saved comparisons, which are
            deleted one at a time and on purpose. */}
        {tab === 'saved' ? null : confirmingClear ? (
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
        {/* Saved comparisons (v0.2.9), grouped by the project they belong to. The
            rows are `SavedList`'s, shared with the Projects screen — two lists of
            the same thing that looked different would be two things to learn. */}
        {tab === 'saved' &&
          [
            ...projects.map((project) => ({
              key: `project-${project.id}`,
              label: project.name,
              entries: saved.filter((entry) => entry.projectId === project.id),
            })),
            {
              key: 'unfiled',
              label: 'Not in a project',
              entries: saved.filter((entry) => entry.projectId === undefined),
            },
          ]
            .filter((group) => group.entries.length > 0)
            .map((group) => (
              <section key={group.key} aria-labelledby={`sgroup-${group.key}`}>
                <h2 className="dd-hgroup" id={`sgroup-${group.key}`}>
                  {group.label}
                </h2>
                <SavedList
                  entries={group.entries.filter((entry) =>
                    query.trim() === ''
                      ? true
                      : entry.name.toLowerCase().includes(query.trim().toLowerCase()),
                  )}
                  testId={`saved-group-${group.key}`}
                  emptyText="Nothing matches that search."
                />
              </section>
            ))}

        {tab === 'saved' && saved.length === 0 && (
          <p className="dd-empty" data-testid="saved-empty">
            Nothing saved yet. Press ⌘S in a comparison to keep it — the inputs and options are
            stored, never the contents, so opening one compares them again.
          </p>
        )}

        {tab === 'recent' && empty && (
          <p className="dd-empty" data-testid="history-empty">
            {rows.length === 0
              ? 'No comparisons yet. Run one and it will show up here.'
              : 'Nothing matches those filters.'}
          </p>
        )}

        {tab === 'recent' &&
          groups.map((group) => (
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
