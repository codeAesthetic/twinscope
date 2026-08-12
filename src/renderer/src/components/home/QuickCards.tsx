import { FileTypeBadge } from '../primitives';
import { QUICK_STARTS } from '../../lib/mockData';

/**
 * Four shortcuts into a comparison, for the cases where dropping two files is
 * not the fastest route (MD §34/§35). Inert until MVP-2 (clipboard, folders)
 * and v0.2.0 (Git refs).
 */
export function QuickCards() {
  return (
    <div className="dd-quick" data-testid="quick-cards">
      {QUICK_STARTS.map((quick) => (
        <button
          key={quick.id}
          type="button"
          className="dd-qcard"
          data-testid={`quick-${quick.id}`}
          title="Wired up in MVP-2"
        >
          <span className="dd-qcard-title">
            <FileTypeBadge kind={quick.kind} />
            {quick.title}
          </span>
          <span className="dd-qcard-desc">{quick.description}</span>
        </button>
      ))}
    </div>
  );
}
