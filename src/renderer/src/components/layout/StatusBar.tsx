import type { ReactNode } from 'react';
import { useStatusStore } from '../../stores/status';

/**
 * Bottom strip. The left side is the standing privacy claim (MD §32) — the
 * product's core promise, so it is always on screen and never overridable.
 *
 * The middle and right are published by whichever screen is showing, via the
 * status store.
 */
export function StatusBar({ right }: { right?: ReactNode }) {
  const detail = useStatusStore((state) => state.detail);
  const statusRight = useStatusStore((state) => state.right);

  return (
    <footer className="dd-statusbar" data-testid="statusbar">
      <span className="dd-statusbar-dot" aria-hidden="true" />
      Local only
      <span>·</span>
      <span data-testid="status-detail">{detail ?? 'Engines: text, json, folder, image'}</span>
      <span className="dd-statusbar-right" data-testid="status-right">
        {statusRight ?? right}
      </span>
    </footer>
  );
}
