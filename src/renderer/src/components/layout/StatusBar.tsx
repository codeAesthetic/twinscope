import type { ReactNode } from 'react';
import { ENGINES } from '../../../../engines/catalog';
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
      {/* The engine list comes from the registry, not from a sentence: it named
          four engines while eleven shipped, and every new engine would have had to
          remember to come back here. */}
      <span data-testid="status-detail">
        {detail ??
          `${ENGINES.length} engines: ${ENGINES.map((engine) => engine.meta.id).join(', ')}`}
      </span>
      <span className="dd-statusbar-right" data-testid="status-right">
        {statusRight ?? right}
      </span>
    </footer>
  );
}
