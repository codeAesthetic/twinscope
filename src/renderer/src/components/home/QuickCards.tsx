import { FileTypeBadge } from '../primitives';
import { QUICK_STARTS } from '../../lib/mockData';

/**
 * Four shortcuts into a comparison, for the cases where dropping two files is
 * not the fastest route (MD §34/§35).
 *
 * **All four do something.** `git` has since v0.2.1; the other three were still inert
 * on 2026-08-13 — buttons with hover styling, no `onClick`, and a tooltip citing a
 * milestone that had shipped months earlier. Their routes existed the whole time
 * (folder picker, ⌘⇧V, file picker); only the cards were never connected.
 *
 * Each card names an **action id** rather than carrying a handler, so a card and its
 * keyboard shortcut run the same code — the rule ⌘S follows. This component knows
 * nothing about what any of them do, and `onSelect` is required: a deck of buttons
 * that might do nothing is what this replaced.
 */
export function QuickCards({ onSelect }: { onSelect: (action: string) => void }) {
  return (
    <div className="dd-quick" data-testid="quick-cards">
      {QUICK_STARTS.map((quick) => (
        <button
          key={quick.id}
          type="button"
          className="dd-qcard"
          data-testid={`quick-${quick.id}`}
          data-action={quick.action}
          title={quick.hint}
          onClick={() => onSelect(quick.action)}
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
