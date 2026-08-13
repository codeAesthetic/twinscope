import { useEffect, useRef, useState } from 'react';
import { Button, Chip, Kbd } from '../components/primitives';
import { useSettingsStore } from '../stores/settings';
import { selectEngineForInputs } from '../../../engines/registry';
import type { ClipboardSignature, InputPayload } from '../../../shared/channels';

/**
 * The Global Quick Compare panel (v0.2.14, MD §35).
 *
 * 420×320, always on top, summoned by a global shortcut. It collects two inputs and
 * **hands them to the main window** rather than comparing here: a panel this size is
 * the wrong place to read a diff, and duplicating the workspace into it would be a
 * second copy of the thing to keep in step.
 *
 * The clipboard watcher *offers*, it never fills. It polls a cheap signature — not
 * the clipboard itself, which would spill every copied image to a temp file — and
 * shows a chip the user clicks. Silently ingesting whatever someone copies is not a
 * thing a privacy-first app does, opt-in or not.
 */

const POLL_MS = 900;

export function QuickScreen() {
  const [a, setA] = useState<InputPayload | null>(null);
  const [b, setB] = useState<InputPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offer, setOffer] = useState<ClipboardSignature | null>(null);

  const preferences = useSettingsStore((state) => state.preferences);
  const load = useSettingsStore((state) => state.load);
  const watching = preferences.clipboardWatcher === true;

  /** The signature already seen, so only a *change* is offered. */
  const seen = useRef<string>('');

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    // No `setOffer(null)` here: a synchronous setState inside an effect triggers a
    // cascading render and lint rejects it (see CLAUDE.md §4). The offer is cleared
    // where the switch is read instead — it is only *rendered* while watching.
    if (!watching) return;

    let live = true;
    const tick = async (): Promise<void> => {
      try {
        const signature = await window.twinscope.clipboard.signature();
        const key = `${signature.kind}:${signature.size}:${signature.hint}`;
        if (!live) return;
        if (signature.kind === 'empty') {
          setOffer(null);
          return;
        }
        // First poll establishes the baseline: whatever was already on the
        // clipboard before the panel opened is not something the user just did.
        if (seen.current === '') {
          seen.current = key;
          return;
        }
        if (key !== seen.current) {
          seen.current = key;
          setOffer(signature);
        }
      } catch {
        // A failing signature is not worth surfacing; the watcher just idles.
      }
    };

    void tick();
    const timer = setInterval(() => void tick(), POLL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [watching]);

  const fill = (input: InputPayload | null): void => {
    if (input === null) return;
    if (a === null) setA({ ...input, side: 'A' });
    else setB({ ...input, side: 'B' });
  };

  const paste = async (): Promise<void> => {
    setError(null);
    try {
      fill(await window.twinscope.clipboard.read(a === null ? 'A' : 'B'));
      setOffer(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const pick = async (): Promise<void> => {
    setError(null);
    try {
      fill(await window.twinscope.dialog.pickFile(a === null ? 'A' : 'B'));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const drop = async (event: React.DragEvent): Promise<void> => {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (file === undefined) return;
    setError(null);
    try {
      const path = window.twinscope.input.pathForFile(file);
      fill(await window.twinscope.input.read(a === null ? 'A' : 'B', path));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const compare = async (): Promise<void> => {
    if (a === null || b === null) return;
    const handed = await window.twinscope.quick.handoff({ a, b });
    if (!handed) {
      setError('The main window is not open, so there is nowhere to hand this to.');
      return;
    }
    setA(null);
    setB(null);
  };

  const detected =
    a !== null && b !== null
      ? selectEngineForInputs(
          { name: a.name, kind: a.kind, ...(a.text !== undefined ? { text: a.text } : {}) },
          { name: b.name, kind: b.kind, ...(b.text !== undefined ? { text: b.text } : {}) },
        ).engine?.meta.label
      : undefined;

  return (
    <div
      className="dd-quick-panel"
      data-testid="quick-panel"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => void drop(event)}
    >
      <div className="dd-quick-head">
        <b>Quick compare</b>
        <Button
          variant="ghost"
          size="sm"
          data-testid="quick-close"
          onClick={() => void window.twinscope.quick.close()}
        >
          ✕
        </Button>
      </div>

      <div className="dd-quick-slots">
        <Slot label="Before" input={a} onClear={() => setA(null)} testId="quick-slot-a" />
        <Slot label="After" input={b} onClear={() => setB(null)} testId="quick-slot-b" />
      </div>

      {watching && offer !== null && (
        // Offered, never taken: the watcher noticed a change, and the user decides.
        <button
          type="button"
          className="dd-quick-offer"
          data-testid="quick-clipboard-offer"
          onClick={() => void paste()}
        >
          Clipboard changed — {offer.kind === 'image' ? 'an image' : `${offer.size} characters`}.
          Use it?
        </button>
      )}

      <div className="dd-quick-actions">
        <Button size="sm" data-testid="quick-paste" onClick={() => void paste()}>
          Paste
        </Button>
        <Button size="sm" data-testid="quick-pick" onClick={() => void pick()}>
          Browse…
        </Button>
        <Button
          size="sm"
          variant="primary"
          data-testid="quick-compare"
          disabled={a === null || b === null}
          onClick={() => void compare()}
        >
          Compare <Kbd>⏎</Kbd>
        </Button>
      </div>

      {detected !== undefined && (
        <p className="dd-quick-detected" data-testid="quick-detected">
          <Chip variant="acc">{detected}</Chip>
        </p>
      )}

      {error !== null && (
        <p className="dd-quick-error" role="alert" data-testid="quick-error">
          {error}
        </p>
      )}

      {!watching && (
        <p className="dd-quick-hint" data-testid="quick-watch-hint">
          Drop a file, paste, or turn the clipboard watcher on in Settings.
        </p>
      )}
    </div>
  );
}

function Slot({
  label,
  input,
  onClear,
  testId,
}: {
  label: string;
  input: InputPayload | null;
  onClear: () => void;
  testId: string;
}) {
  return (
    <div
      className="dd-quick-slot"
      data-filled={input === null ? 'false' : 'true'}
      data-testid={testId}
    >
      <span className="dd-quick-slotlabel">{label}</span>
      {input === null ? (
        <span className="dd-quick-empty">empty</span>
      ) : (
        <>
          <span className="dd-quick-name" title={input.name}>
            {input.name}
          </span>
          <button type="button" aria-label={`Clear ${label}`} onClick={onClear}>
            ✕
          </button>
        </>
      )}
    </div>
  );
}
