import { useEffect } from 'react';
import { matches } from './shortcuts';

/**
 * The next mode in the ring, wrapping at the end.
 *
 * A current value that is not in the ring restarts at the first — a mode
 * remembered from an older build must not wedge the cycle.
 */
export function nextMode<T>(modes: readonly T[], current: T): T {
  if (modes.length === 0) return current;
  const at = modes.indexOf(current);
  return modes[(at + 1) % modes.length] ?? current;
}

/**
 * `⌘\` — cycle the view mode of whichever engine view is on screen.
 *
 * The binding lives with the view that can perform it, the way ⌘⇧E lives with
 * the export menu and ⌘F with the toolbar search (see `intake.ts`: "the rest
 * belong to the surface that can perform them"). It was advertised in the
 * shortcut registry and in Settings for three milestones with nothing listening.
 */
export function useViewModeCycle(cycle: () => void): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!matches(event, '⌘\\')) return;
      event.preventDefault();
      cycle();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [cycle]);
}
