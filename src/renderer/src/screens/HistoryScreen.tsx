import { Chip, FileTypeBadge, SearchInput, Toggle } from '../components/primitives';
import { HISTORY_GROUPS } from '../lib/mockData';
import { useState } from 'react';

/**
 * History (MD §36) — reopen something you were just looking at.
 *
 * Static for HOME-4. MVP-8 replaces the mock groups with SQLite records and
 * makes rows, starring and search live.
 *
 * No "Saved" tab: saved comparison definitions are V1-9, and MVP-8's plan entry
 * already decided the History screen ships without them. Building a static tab
 * for a feature months out would only rot.
 */
export function HistoryScreen() {
  const [starredOnly, setStarredOnly] = useState(false);

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
        <SearchInput placeholder="Search history…" />
      </div>

      <div className="dd-history">
        {HISTORY_GROUPS.map((group) => (
          <section key={group.label} aria-labelledby={`hgroup-${group.label}`}>
            <h2 className="dd-hgroup" id={`hgroup-${group.label}`}>
              {group.label}
            </h2>
            <ul className="dd-hlist">
              {group.items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className="dd-hitem"
                    data-testid={`history-${item.id}`}
                    title="Reopening arrives in MVP-8"
                  >
                    <span
                      className="dd-hitem-star"
                      // Always a literal string: React drops attributes whose
                      // value is `undefined`, which would make the unstarred
                      // state unaddressable from CSS and tests.
                      data-starred={item.starred === true ? 'true' : 'false'}
                      aria-label={item.starred === true ? 'Starred' : 'Not starred'}
                    >
                      {item.starred ? '★' : '☆'}
                    </span>
                    <FileTypeBadge kind={item.kind} />
                    <span className="dd-hitem-col">
                      <span className="dd-hitem-name">{item.title}</span>
                      <span className="dd-hitem-path">{item.path}</span>
                    </span>
                    <span className="dd-hitem-chips">
                      {item.chips.map((chip) => (
                        <Chip key={chip.label} variant={chip.variant}>
                          {chip.label}
                        </Chip>
                      ))}
                    </span>
                    <span className="dd-hitem-ago">{item.ago}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
