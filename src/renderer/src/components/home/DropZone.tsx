import { Button, FileTypeBadge } from '../primitives';
import type { DropZoneInput } from './types';

export type DropZoneSide = 'BEFORE' | 'AFTER';

/**
 * One half of the compare input. Two states, both from the mockup:
 * empty (dashed border, call to action) and filled (accent border, file card).
 *
 * Static for HOME-2 — the buttons carry no handler yet and `data-state` is
 * driven by props. MVP-2 adds drop/browse/paste and the `over` state.
 */
export function DropZone({ side, input }: { side: DropZoneSide; input?: DropZoneInput }) {
  const filled = input !== undefined;

  return (
    <section
      className="dd-drop"
      data-state={filled ? 'filled' : 'empty'}
      data-testid={`drop-${side.toLowerCase()}`}
      aria-label={`${side} input`}
    >
      <div className="dd-drop-label">{side}</div>

      {input ? (
        <div className="dd-filecard">
          <div className="dd-filecard-row">
            <FileTypeBadge kind={input.kind} />
            <div style={{ minWidth: 0 }}>
              <div className="dd-filecard-name">{input.name}</div>
              <div className="dd-filecard-meta">{input.meta}</div>
            </div>
            <span className="dd-filecard-clear">
              <Button variant="ghost" size="sm" aria-label={`Clear ${side} input`}>
                ✕
              </Button>
            </span>
          </div>
          <pre className="dd-filecard-preview">{input.preview.slice(0, 4).join('\n')}</pre>
        </div>
      ) : (
        <div className="dd-drop-empty">
          <span className="dd-drop-glyph" aria-hidden="true">
            ⤓
          </span>
          <strong>Drop anything</strong>
          <span style={{ fontSize: 11.5 }}>file · folder · image · or paste with ⌘⇧V</span>
          <div className="dd-drop-actions">
            <Button size="sm" title="Wired up in MVP-2">
              Browse file…
            </Button>
            <Button size="sm" title="Wired up in MVP-2">
              Folder…
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
