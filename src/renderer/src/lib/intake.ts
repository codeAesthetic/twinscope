import { useCallback, useEffect } from 'react';
import { matches, SHORTCUTS } from './shortcuts';
import { useChangeNavStore } from '../stores/changeNav';
import { useCompareStore } from '../stores/compare';
import type { InputPayload } from '../../../shared/channels';

/**
 * Every route an input can arrive by: drop, browse, or paste (MD §3).
 *
 * All of them converge on `setInput`, so the drop zones never care where an
 * input came from.
 */

/**
 * Whether a keystroke belongs to whatever the user is typing into.
 *
 * The one check that keeps global bindings from stealing keys out of a text
 * field. Shared deliberately: the keymap and the paste listener must agree, or
 * ⌘V would fill a drop zone while someone was editing an ignored path.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  return (
    element?.tagName === 'INPUT' ||
    element?.tagName === 'TEXTAREA' ||
    element?.isContentEditable === true
  );
}

/** Fills A first, then B — the order the user is reading in. */
export function nextEmptySide(a: InputPayload | null, b: InputPayload | null): 'A' | 'B' {
  if (a === null) return 'A';
  if (b === null) return 'B';
  // Both taken: replace BEFORE, which is what a third paste most likely means.
  return 'A';
}

/**
 * A text selection dragged in from another app, as an input.
 *
 * Returns null for whitespace-only content: an accidental drag should leave the
 * zone alone rather than fill it with nothing.
 */
export function droppedText(side: 'A' | 'B', text: string): InputPayload | null {
  if (text.trim().length === 0) return null;
  return {
    side,
    kind: 'text',
    name: `dropped-${side.toLowerCase()}.txt`,
    size: text.length,
    text,
  };
}

export function useIntake(): {
  fromDrop: (side: 'A' | 'B', dataTransfer: DataTransfer) => Promise<void>;
  fromClipboard: (side?: 'A' | 'B') => Promise<void>;
} {
  const setInput = useCompareStore((state) => state.setInput);

  const fromDrop = useCallback(
    async (side: 'A' | 'B', dataTransfer: DataTransfer) => {
      const files = [...dataTransfer.files];

      if (files.length > 0) {
        // Only the first file is used: a zone holds one input, and silently
        // picking one of several would be worse than ignoring the rest.
        const path = window.twinscope.input.pathForFile(files[0]!);
        if (path.length > 0) {
          setInput(side, await window.twinscope.input.read(side, path));
          return;
        }
      }

      // No file path — a text selection dragged from another app.
      const text = dataTransfer.getData('text/plain');
      const payload = droppedText(side, text);
      if (payload !== null) setInput(side, payload);
    },
    [setInput],
  );

  const fromClipboard = useCallback(
    async (side?: 'A' | 'B') => {
      const { a, b } = useCompareStore.getState();
      const target = side ?? nextEmptySide(a, b);
      const payload = await window.twinscope.clipboard.read(target);
      if (payload !== null) setInput(target, payload);
    },
    [setInput],
  );

  return { fromDrop, fromClipboard };
}

/**
 * The app's keyboard map, driven by the registry in `lib/shortcuts.ts` (MD §10).
 *
 * Registered once at the root. Every binding here comes from that table, so the
 * Settings screen and the command palette describe exactly what fires — there is
 * no second list to drift.
 */
export function useAppShortcuts(onRun: () => void, onAction: (id: string) => void): void {
  const nextChange = useChangeNavStore((state) => state.next);
  const previousChange = useChangeNavStore((state) => state.previous);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const typing = isTypingTarget(event.target);

      // ⌥↓ / ⌥↑ — step through changes (MD §11). Only when there are any, so
      // the keys stay available to the OS otherwise.
      if (matches(event, '⌥↓') || matches(event, '⌥↑')) {
        if (useChangeNavStore.getState().count > 0) {
          event.preventDefault();
          if (event.key === 'ArrowDown') nextChange();
          else previousChange();
          return;
        }
      }

      for (const shortcut of SHORTCUTS) {
        if (!DISPATCHED.has(shortcut.id)) continue;
        if (!matches(event, shortcut.combo)) continue;
        event.preventDefault();
        onAction(shortcut.id);
        return;
      }

      // Enter — run, unless the user is typing in a field.
      if (event.key === 'Enter' && !typing && !event.metaKey && !event.ctrlKey) {
        const { a, b, status } = useCompareStore.getState();
        if (a !== null && b !== null && status !== 'running') {
          event.preventDefault();
          onRun();
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onRun, onAction, nextChange, previousChange]);
}

/**
 * Plain ⌘V, the way the approved mockup specified it.
 *
 * A `paste` listener rather than a key binding, so the *platform* decides what
 * counts as a paste — that keeps ⌘V working normally inside every text field,
 * and picks up the OS variants (Edit menu, middle-click on Linux) for free.
 *
 * The event is only a trigger: the payload still comes from `clipboard.read` in
 * main, so text, images and detection all follow the one path ⌘⇧V already uses.
 */
export function useClipboardIntake(): void {
  const { fromClipboard } = useIntake();

  useEffect(() => {
    const onPaste = (event: ClipboardEvent): void => {
      // Someone is typing: the field gets the paste, not the comparison.
      if (isTypingTarget(event.target)) return;
      event.preventDefault();
      void fromClipboard();
    };

    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [fromClipboard]);
}

/**
 * Bindings this hook owns. The rest belong to the surface that can perform them:
 * ⌘K to the palette, ⌘F to the toolbar search, ⌘⇧E to the export menu, ⌘\ to
 * whichever engine view has view modes.
 */
const DISPATCHED = new Set([
  'open-files',
  'open-folders',
  'paste-compare',
  'swap',
  'theme',
  'settings',
  'view-compare',
  'view-history',
  'view-projects',
  // v0.2.9. Unlike ⌘F/⌘⇧E/⌘\, saving needs no surface of its own: the compare
  // store already holds everything a saved comparison is made of, so the action
  // can be performed from here and the workspace button calls the same function.
  'save-comparison',
]);
