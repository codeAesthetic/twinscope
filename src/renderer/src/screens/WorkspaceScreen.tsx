import { createElement, Suspense, useEffect, useRef, useState } from 'react';
import { SummaryStrip } from '../components/compare/SummaryStrip';
import { ToolbarSlotProvider } from '../components/compare/ToolbarSlot';
import { Button, Chip, SearchInput } from '../components/primitives';
import { useAppStore } from '../stores/app';
import { useChangeNavStore } from '../stores/changeNav';
import { useCompareStore, type CompareResult } from '../stores/compare';
import { useSearchStore } from '../stores/search';
import { useStatusStore } from '../stores/status';
import { engineViewFor } from './workspace/engineViews';

/**
 * The comparison workspace — the chassis every engine view plugs into (MD §11).
 *
 * It owns the toolbar, the summary strip, change navigation and the job states
 * (running / cancelled / failed / done). It knows nothing about diffs: the result
 * body comes from `engineViewFor(engineId)`, code-split per engine.
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
  const run = useCompareStore((state) => state.run);
  const reset = useCompareStore((state) => state.reset);
  const setView = useAppStore((state) => state.setView);
  const setStatus = useStatusStore((state) => state.set);
  const clearStatus = useStatusStore((state) => state.clear);
  const clearNav = useChangeNavStore((state) => state.clear);

  const [toolbarSlot, setToolbarSlot] = useState<HTMLElement | null>(null);
  const [copied, setCopied] = useState(false);

  // The status bar belongs to the frame, so the screen publishes into it.
  useEffect(() => {
    if (result !== null) {
      setStatus({ detail: `${result.engineId} engine`, right: `Compared in ${result.ms} ms` });
    } else if (status === 'running') {
      setStatus({ detail: engineLabel ?? 'comparing', right: `${percent}%` });
    }
    return clearStatus;
  }, [result, status, percent, engineLabel, setStatus, clearStatus]);

  const startOver = (): void => {
    // "New" means new: clearing the inputs too, or Compare shows a stale ready
    // state with the previous pair still loaded.
    clearNav();
    reset();
    setView('compare');
  };

  const copyDetails = async (): Promise<void> => {
    if (error === null) return;
    await window.devdiff.clipboard.write(
      [
        `DevDiff ${error.reason}: ${error.message}`,
        a !== null ? `before: ${a.name} (${a.kind})` : null,
        b !== null ? `after:  ${b.name} (${b.kind})` : null,
        engineLabel !== null ? `engine: ${engineLabel}` : null,
      ]
        .filter((line) => line !== null)
        .join('\n'),
    );
    setCopied(true);
  };

  return (
    <ToolbarSlotProvider element={toolbarSlot}>
      <div
        style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}
        data-testid="screen-workspace"
      >
        <div className="dd-toolbar" data-testid="workspace-toolbar">
          {engineLabel !== null && <Chip variant="acc">{engineLabel}</Chip>}

          {/* Engine views portal their own controls in here. */}
          <span ref={setToolbarSlot} data-testid="toolbar-slot" style={{ display: 'contents' }} />

          {status === 'running' && (
            <Button variant="ghost" onClick={() => void cancel()} data-testid="cancel-button">
              Cancel
            </Button>
          )}

          <span className="dd-spacer" />

          {result !== null && (
            <>
              <WorkspaceSearch />
              <Button disabled title="Export arrives in MVP-9">
                Export ▾
              </Button>
            </>
          )}

          <Button variant="ghost" onClick={startOver} data-testid="back-button">
            ← New comparison
          </Button>
        </div>

        {result !== null && (
          <SummaryStrip
            summary={result.summary}
            right={
              <Chip>
                {a?.name} ↔ {b?.name}
              </Chip>
            }
          />
        )}

        <div className="dd-comparison-area" data-fill={status === 'done' ? 'true' : undefined}>
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
                style={{
                  margin: 0,
                  color: 'var(--tx-3)',
                  fontSize: 11.5,
                  fontFamily: 'var(--mono)',
                }}
              >
                {percent}% {progressMessage !== null && `· ${progressMessage}`}
              </p>
            </div>
          )}

          {status === 'error' && error !== null && (
            <div data-testid="job-error" style={{ maxWidth: 440 }}>
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
              <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                {/* A wrong-engine failure is recoverable: offer the engine that
                    can still say something about these inputs. */}
                {error.fallback !== undefined && (
                  <Button
                    variant="primary"
                    data-testid="error-fallback"
                    onClick={() => {
                      const { engineId } = error.fallback as { engineId: string };
                      void run({ engineId }).catch(() => undefined);
                    }}
                  >
                    {error.fallback.label}
                  </Button>
                )}
                <Button onClick={startOver}>Back to Compare</Button>
                {error.reason !== 'cancelled' && (
                  <Button
                    variant="ghost"
                    onClick={() => void copyDetails()}
                    data-testid="copy-details"
                  >
                    {copied ? 'Copied ✓' : 'Copy details'}
                  </Button>
                )}
              </div>
            </div>
          )}

          {status === 'done' && result !== null && (
            <Suspense
              fallback={
                <p style={{ color: 'var(--tx-3)', fontSize: 12.5 }}>Loading engine view…</p>
              }
            >
              <EngineResult result={result} />
            </Suspense>
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
    </ToolbarSlotProvider>
  );
}

/**
 * The toolbar's search box. Disabled until an engine view opts in, because a
 * search field that silently does nothing is worse than one that says it can't.
 */
function WorkspaceSearch() {
  const enabled = useSearchStore((state) => state.enabled);
  const query = useSearchStore((state) => state.query);
  const placeholder = useSearchStore((state) => state.placeholder);
  const setQuery = useSearchStore((state) => state.setQuery);
  const focusRequest = useSearchStore((state) => state.focusRequest);
  const requestFocus = useSearchStore((state) => state.requestFocus);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        requestFocus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [requestFocus]);

  useEffect(() => {
    if (focusRequest > 0 && enabled) inputRef.current?.focus();
  }, [focusRequest, enabled]);

  return (
    <SearchInput
      ref={inputRef}
      placeholder={placeholder}
      hint="⌘F"
      disabled={!enabled}
      value={query}
      onChange={(event) => setQuery(event.target.value)}
      data-testid="workspace-search"
    />
  );
}

/**
 * Renders the engine's own view, or a plain summary when that engine has no
 * view yet — which is how an engine can ship its logic before its UI.
 *
 * The lookup is deliberately not assigned to a capitalised variable in the
 * parent's body: rendering a component from a render-scoped binding trips
 * react-hooks' "cannot create components during render" rule, and the lazy
 * component itself is already module-level and stable.
 */
function EngineResult({ result }: { result: CompareResult }) {
  const view = engineViewFor(result.engineId);

  if (view === undefined) {
    return (
      <div data-testid="job-done">
        <p style={{ margin: 0, color: 'var(--tx-2)', fontSize: 15, fontWeight: 600 }}>
          Compared in {result.ms} ms
        </p>
        <p style={{ margin: '8px 0 0', color: 'var(--tx-3)', fontSize: 12.5 }}>
          The {result.engineId} engine has no view yet.
        </p>
      </div>
    );
  }

  return createElement(view, { result });
}
