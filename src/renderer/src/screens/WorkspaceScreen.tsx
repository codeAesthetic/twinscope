import { ChangeNav, SummaryStrip } from '../components/compare/SummaryStrip';
import { Button, Chip } from '../components/primitives';
import { useAppStore } from '../stores/app';
import { useCompareStore } from '../stores/compare';

/**
 * The comparison workspace — the shared chassis every engine view plugs into
 * (MD §11): toolbar, summary strip, change navigation, then the result area.
 *
 * MVP-1 makes the job lifecycle real: running, cancelled, failed and done are
 * all driven by events from the engine host. The result *body* is still empty —
 * MVP-4..7 fill it per engine, which is why nothing here knows about diffs.
 */
export function WorkspaceScreen() {
  const status = useCompareStore((state) => state.status);
  const percent = useCompareStore((state) => state.percent);
  const progressMessage = useCompareStore((state) => state.progressMessage);
  const engineLabel = useCompareStore((state) => state.engineLabel);
  const result = useCompareStore((state) => state.result);
  const error = useCompareStore((state) => state.error);
  const a = useCompareStore((state) => state.a);
  const b = useCompareStore((state) => state.b);
  const cancel = useCompareStore((state) => state.cancel);
  const reset = useCompareStore((state) => state.reset);
  const setView = useAppStore((state) => state.setView);

  return (
    <div
      style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}
      data-testid="screen-workspace"
    >
      <div className="dd-toolbar" data-testid="workspace-toolbar">
        {engineLabel !== null && <Chip variant="acc">{engineLabel}</Chip>}
        {status === 'running' && (
          <Button variant="ghost" onClick={() => void cancel()} data-testid="cancel-button">
            Cancel
          </Button>
        )}
        <span className="dd-spacer" />
        <Button
          variant="ghost"
          onClick={() => {
            // It says "new", so it clears the inputs too — navigating alone left
            // the previous pair loaded and the Compare screen showing a stale
            // "ready" state.
            reset();
            setView('compare');
          }}
          data-testid="back-button"
        >
          ← New comparison
        </Button>
      </div>

      {result !== null && (
        <SummaryStrip
          counts={{
            added: result.summary.added,
            removed: result.summary.removed,
            modified: result.summary.modified,
          }}
          navigation={<ChangeNav index={1} total={totalOf(result.summary)} />}
          right={
            <Chip>
              {a?.name} ↔ {b?.name}
            </Chip>
          }
        />
      )}

      <div className="dd-comparison-area">
        {status === 'running' && (
          <div data-testid="job-progress" style={{ width: 320 }}>
            <p style={{ margin: 0, color: 'var(--tx-2)', fontSize: 13, fontWeight: 600 }}>
              Comparing…
            </p>
            <div
              role="progressbar"
              aria-valuenow={percent}
              aria-valuemin={0}
              aria-valuemax={100}
              style={{
                height: 6,
                borderRadius: 99,
                background: 'var(--line)',
                overflow: 'hidden',
                margin: '12px 0 8px',
              }}
            >
              <div
                data-testid="progress-fill"
                style={{
                  height: '100%',
                  width: `${percent}%`,
                  background: 'var(--acc)',
                  transition: 'width 0.15s linear',
                }}
              />
            </div>
            <p
              data-testid="progress-label"
              style={{ margin: 0, color: 'var(--tx-3)', fontSize: 11.5, fontFamily: 'var(--mono)' }}
            >
              {percent}% {progressMessage !== null && `· ${progressMessage}`}
            </p>
          </div>
        )}

        {status === 'error' && error !== null && (
          <div data-testid="job-error" style={{ maxWidth: 420 }}>
            <p
              style={{
                margin: 0,
                color: error.reason === 'cancelled' ? 'var(--tx-2)' : 'var(--del)',
                fontSize: 15,
                fontWeight: 600,
              }}
            >
              {error.reason === 'cancelled' ? 'Comparison cancelled' : 'Comparison failed'}
            </p>
            <p style={{ margin: '8px 0 14px', color: 'var(--tx-3)', fontSize: 12.5 }}>
              {error.message}
            </p>
            <Button onClick={() => setView('compare')}>Back to Compare</Button>
          </div>
        )}

        {status === 'done' && result !== null && (
          <div data-testid="job-done">
            <p style={{ margin: 0, color: 'var(--tx-2)', fontSize: 15, fontWeight: 600 }}>
              Compared in {result.ms} ms
            </p>
            <p style={{ margin: '8px 0 0', color: 'var(--tx-3)', fontSize: 12.5 }}>
              Engine views fill this area from MVP-4 onward.
            </p>
            {result.normalizationNotes.length > 0 && (
              <ul
                data-testid="normalization-notes"
                style={{
                  margin: '14px 0 0',
                  padding: 0,
                  listStyle: 'none',
                  color: 'var(--tx-3)',
                  fontSize: 11.5,
                }}
              >
                {result.normalizationNotes.map((note) => (
                  <li key={note}>· {note}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {status === 'idle' && (
          <div>
            <p style={{ margin: 0, color: 'var(--tx-2)', fontSize: 15, fontWeight: 600 }}>
              Drop two inputs to start
            </p>
            <p style={{ margin: '8px 0 0', color: 'var(--tx-3)', fontSize: 12.5 }}>
              Nothing is running.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function totalOf(summary: { added: number; removed: number; modified: number }): number {
  return summary.added + summary.removed + summary.modified;
}
