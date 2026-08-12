import { useEffect, useState } from 'react';
import type { PingResult } from '../../../shared/channels';

/** Placeholder shell — replaced by the real app frame in HOME-1. */
export function BootScreen() {
  const [ping, setPing] = useState<PingResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    window.devdiff
      .ping()
      .then(setPing)
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, []);

  return (
    <main
      style={{ height: '100%', display: 'grid', placeItems: 'center' }}
      data-testid="boot-screen"
    >
      <div style={{ textAlign: 'center' }}>
        <div
          style={{
            width: 34,
            height: 34,
            margin: '0 auto 14px',
            borderRadius: 10,
            background: 'linear-gradient(140deg, var(--acc), #4ad2ff)',
            position: 'relative',
          }}
        >
          <span
            style={{
              position: 'absolute',
              inset: '8px 15px 8px 8px',
              background: 'rgba(255,255,255,.92)',
              borderRadius: '3px 0 0 3px',
            }}
          />
        </div>

        <h1 style={{ fontSize: 20, fontWeight: 650, letterSpacing: '-0.02em', margin: 0 }}>
          DevDiff
        </h1>
        <p style={{ color: 'var(--tx-2)', margin: '6px 0 0' }}>
          Compare anything. Understand what changed.
        </p>

        <p
          data-testid="bridge-status"
          style={{ color: 'var(--tx-3)', marginTop: 22, fontSize: 11.5 }}
        >
          {error !== null
            ? `bridge error: ${error}`
            : ping
              ? `bridge ok · electron ${ping.versions.electron} · chrome ${ping.versions.chrome} · node ${ping.versions.node}`
              : 'connecting…'}
        </p>
      </div>
    </main>
  );
}
