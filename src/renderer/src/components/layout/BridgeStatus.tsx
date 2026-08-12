import { useEffect, useState } from 'react';
import type { PingResult } from '../../../../shared/channels';

/**
 * Live proof the preload bridge works, parked in the status bar.
 *
 * It replaces the SETUP-2 boot screen: the same "is IPC alive?" question, but
 * answerable at a glance without occupying the whole window.
 */
export function BridgeStatus() {
  const [ping, setPing] = useState<PingResult | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    window.devdiff
      .ping()
      .then(setPing)
      .catch(() => setFailed(true));
  }, []);

  if (failed) return <span data-testid="bridge-status">bridge unavailable</span>;

  return (
    <span data-testid="bridge-status">
      {ping ? `electron ${ping.versions.electron}` : 'connecting…'}
    </span>
  );
}
