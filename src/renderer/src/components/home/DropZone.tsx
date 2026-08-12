import { useState } from 'react';
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
  if (input.kind === 'image') return input.lang ?? 'image';
  if (input.large === true) return `${formatSize(input.size)} — read on demand`;
  if (input.text === undefined) return input.kind;
  return input.text.split('\n').slice(0, 4).join('\n');
}

/**
 * One half of the compare input: empty (dashed, call to action) or filled
 * (accent border, file card), plus the drag-over highlight.
 *
 * Handlers are optional — without them the zone is inert, which is how the
 * `#gallery` renders both states without touching the filesystem.
 */
export function DropZone({
  side,
  input,
  onPickFile,
  onPickFolder,
  onClear,
  onDrop,
}: {
  side: DropZoneSide;
  input?: InputPayload | null;
  onPickFile?: () => void;
  onPickFolder?: () => void;
  onClear?: () => void;
  onDrop?: (dataTransfer: DataTransfer) => void;
}) {
  const [isOver, setIsOver] = useState(false);
  const filled = input !== undefined && input !== null;
  const state = isOver ? 'over' : filled ? 'filled' : 'empty';

  const dragProps =
    onDrop === undefined
      ? {}
      : {
          onDragOver: (event: React.DragEvent) => {
            // Without preventDefault the browser navigates to the dropped file.
            event.preventDefault();
            setIsOver(true);
          },
          onDragLeave: () => setIsOver(false),
          onDrop: (event: React.DragEvent) => {
            event.preventDefault();
            setIsOver(false);
            onDrop(event.dataTransfer);
          },
        };

  return (
    <section
      className="dd-drop"
      data-state={state}
      data-testid={`drop-${side.toLowerCase()}`}
      aria-label={`${side} input`}
      {...dragProps}
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
          <strong>{isOver ? 'Release to compare' : 'Drop anything'}</strong>
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
