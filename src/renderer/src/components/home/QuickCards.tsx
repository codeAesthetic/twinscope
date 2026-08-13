import { FileTypeBadge } from '../primitives';
import { QUICK_STARTS } from '../../lib/mockData';

/**
 * Four shortcuts into a comparison, for the cases where dropping two files is
 * not the fastest route (MD §34/§35).
 *
 * `git` is live as of v0.2.1 and opens the ref panel. The other three are still
 * descriptive: their routes exist (folder picker, ⌘⇧V, file picker) but as
 * *cards* they were never wired, and doing so is not this feature's business.
 */
export function QuickCards({ onSelect }: { onSelect?: (id: string) => void }) {
  return (
    <div className="dd-quick" data-testid="quick-cards">
      {QUICK_STARTS.map((quick) => {
        const live = quick.id === 'git' && onSelect !== undefined;
        return (
          <button
            key={quick.id}
            type="button"
            className="dd-qcard"
            data-testid={`quick-${quick.id}`}
            data-live={live ? 'true' : 'false'}
            title={live ? 'Compare two git refs' : 'Wired up in MVP-2'}
            {...(live ? { onClick: () => onSelect(quick.id) } : {})}
          >
            <span className="dd-qcard-title">
              <FileTypeBadge kind={quick.kind} />
              {quick.title}
            </span>
            <span className="dd-qcard-desc">{quick.description}</span>
          </button>
        );
      })}
    </div>
  );
}
