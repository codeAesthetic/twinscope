import { Button, Chip, FileTypeBadge } from '../primitives';
import { RECENT_COMPARISONS } from '../../lib/mockData';
import { useAppStore } from '../../stores/app';

/**
 * Recent comparisons (MD §36) — the shortest path back to something you were
 * just looking at.
 *
 * Rows are inert until MVP-8 gives them real records to reopen; "View all"
 * already navigates, since the History screen exists.
 */
export function RecentList() {
  const setView = useAppStore((state) => state.setView);

  return (
    <section className="dd-recent" data-testid="recent-list" aria-labelledby="recent-heading">
      <div className="dd-recent-head">
        <h2 id="recent-heading">Recent comparisons</h2>
        <Button variant="ghost" size="sm" onClick={() => setView('history')}>
          View all →
        </Button>
      </div>

      <ul className="dd-rlist">
        {RECENT_COMPARISONS.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              className="dd-ritem"
              data-testid={`recent-${item.id}`}
              title="Reopening arrives in MVP-8"
            >
              <FileTypeBadge kind={item.kind} />
              <span className="dd-ritem-col">
                <span className="dd-ritem-name">{item.title}</span>
                <span className="dd-ritem-path">{item.path}</span>
              </span>
              <span className="dd-ritem-chips">
                {item.chips.map((chip) => (
                  <Chip key={chip.label} variant={chip.variant}>
                    {chip.label}
                  </Chip>
                ))}
              </span>
              <span className="dd-ritem-ago">{item.ago}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
