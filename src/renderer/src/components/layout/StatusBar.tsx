import type { ReactNode } from 'react';

/**
 * Bottom strip. Left side is the standing privacy claim (MD §32) — it is the
 * product's core promise, so it is always on screen.
 */
export function StatusBar({ left, right }: { left?: ReactNode; right?: ReactNode }) {
  return (
    <footer className="dd-statusbar" data-testid="statusbar">
      <span className="dd-statusbar-dot" aria-hidden="true" />
      Local only
      <span>·</span>
      {left ?? <span>Engines: text, json, folder, image</span>}
      <span className="dd-statusbar-right">{right ?? <span>Ready</span>}</span>
    </footer>
  );
}
