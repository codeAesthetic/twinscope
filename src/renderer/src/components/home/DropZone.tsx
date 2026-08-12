import { Button, FileTypeBadge } from '../primitives';
import type { FileKind } from '../primitives';
import type { InputPayload } from '../../../../shared/channels';

export type DropZoneSide = 'BEFORE' | 'AFTER';

/** Engine kinds map onto the badge's smaller vocabulary. */
const BADGE_KIND: Record<string, FileKind> = {
  json: 'json',
  code: 'code',
  yaml: 'json',
  csv: 'md',
  md: 'md',
  image: 'image',
  folder: 'folder',
  text: 'text',
  binary: 'text',
  unknown: 'text',
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function preview(input: InputPayload): string {
  if (input.kind === 'folder') return 'folder';
  if (input.large === true) return `${formatSize(input.size)} — read on demand`;
  if (input.text === undefined) return input.kind;
  return input.text.split('\n').slice(0, 4).join('\n');
}

/**
 * One half of the compare input. Two states, both from the mockup: empty
 * (dashed border, call to action) and filled (accent border, file card).
 *
 * Handlers are optional — without them the buttons stay inert, which is how the
 * `#gallery` renders both states without touching the filesystem.
 */
export function DropZone({
  side,
  input,
  onPickFile,
  onPickFolder,
  onClear,
}: {
  side: DropZoneSide;
  input?: InputPayload | null;
  onPickFile?: () => void;
  onPickFolder?: () => void;
  onClear?: () => void;
}) {
  const filled = input !== undefined && input !== null;

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
            <FileTypeBadge kind={BADGE_KIND[input.kind] ?? 'text'} />
            <div style={{ minWidth: 0 }}>
              <div className="dd-filecard-name">{input.name}</div>
              <div className="dd-filecard-meta">
                {formatSize(input.size)} · {input.kind}
              </div>
            </div>
            <span className="dd-filecard-clear">
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Clear ${side} input`}
                data-testid={`clear-${side.toLowerCase()}`}
                {...(onClear ? { onClick: onClear } : {})}
              >
                ✕
              </Button>
            </span>
          </div>
          <pre className="dd-filecard-preview">{preview(input)}</pre>
        </div>
      ) : (
        <div className="dd-drop-empty">
          <span className="dd-drop-glyph" aria-hidden="true">
            ⤓
          </span>
          <strong>Drop anything</strong>
          <span style={{ fontSize: 11.5 }}>file · folder · image · or paste with ⌘⇧V</span>
          <div className="dd-drop-actions">
            <Button
              size="sm"
              data-testid={`pick-file-${side.toLowerCase()}`}
              {...(onPickFile ? { onClick: onPickFile } : { title: 'Wired up in MVP-2' })}
            >
              Browse file…
            </Button>
            <Button
              size="sm"
              data-testid={`pick-folder-${side.toLowerCase()}`}
              {...(onPickFolder ? { onClick: onPickFolder } : { title: 'Wired up in MVP-2' })}
            >
              Folder…
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
