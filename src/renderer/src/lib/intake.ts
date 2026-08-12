import { useCallback, useEffect } from 'react';
import { useChangeNavStore } from '../stores/changeNav';
import { useCompareStore } from '../stores/compare';
import type { InputPayload } from '../../../shared/channels';

/**
 * Every route an input can arrive by: drop, browse, or paste (MD §3).
 *
 * All of them converge on `setInput`, so the drop zones never care where an
 * input came from.
 */

/** Fills A first, then B — the order the user is reading in. */
function nextEmptySide(a: InputPayload | null, b: InputPayload | null): 'A' | 'B' {
  if (a === null) return 'A';
  if (b === null) return 'B';
  // Both taken: replace BEFORE, which is what a third paste most likely means.
  return 'A';
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
        const path = window.devdiff.input.pathForFile(files[0]!);
        if (path.length > 0) {
          setInput(side, await window.devdiff.input.read(side, path));
          return;
        }
      }

      // No file path — a text selection dragged from another app.
      const text = dataTransfer.getData('text/plain');
      if (text.trim().length > 0) {
        setInput(side, {
          side,
          kind: 'text',
          name: `dropped-${side.toLowerCase()}.txt`,
          size: text.length,
          text,
        });
      }
    },
    [setInput],
  );

  const fromClipboard = useCallback(
    async (side?: 'A' | 'B') => {
      const { a, b } = useCompareStore.getState();
      const target = side ?? nextEmptySide(a, b);
      const payload = await window.devdiff.clipboard.read(target);
      if (payload !== null) setInput(target, payload);
    },
    [setInput],
  );

  return { fromDrop, fromClipboard };
}

/**
 * App-level shortcuts for intake and running (MD §34, §10).
 *
 * Registered once at the root. The full keyboard map, its conflict checks and
 * the shortcuts UI arrive together in MVP-10; these three are the ones intake
 * would feel broken without.
 */
export function useIntakeShortcuts(onRun: () => void): void {
  const { fromClipboard } = useIntake();
  const swap = useCompareStore((state) => state.swap);
  const nextChange = useChangeNavStore((state) => state.next);
  const previousChange = useChangeNavStore((state) => state.previous);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const meta = event.metaKey || event.ctrlKey;
      const target = event.target as HTMLElement | null;
      const typing =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable === true;

      // ⌘⇧V — paste to compare.
      if (meta && event.shiftKey && event.key.toLowerCase() === 'v') {
        event.preventDefault();
        void fromClipboard();
        return;
      }

      // ⌘⇧S — swap sides.
      if (meta && event.shiftKey && event.key.toLowerCase() === 's') {
        event.preventDefault();
        swap();
        return;
      }

      // ⌥↓ / ⌥↑ — step through changes (MD §11).
      if (event.altKey && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
        if (useChangeNavStore.getState().count > 0) {
          event.preventDefault();
          if (event.key === 'ArrowDown') nextChange();
          else previousChange();
          return;
        }
      }

      // Enter — run, unless the user is typing in a field.
      if (event.key === 'Enter' && !typing && !meta) {
        const { a, b, status } = useCompareStore.getState();
        if (a !== null && b !== null && status !== 'running') {
          event.preventDefault();
          onRun();
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [fromClipboard, swap, onRun, nextChange, previousChange]);
}
