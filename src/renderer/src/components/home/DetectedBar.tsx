import { useState } from 'react';
import { Button, Chip, Kbd } from '../primitives';
import { useIsDev, useLoadSample, useRunComparison, useRunDemo } from '../../lib/compareClient';
import { useCompareStore } from '../../stores/compare';
import { ENGINES, selectEngineForInputs } from '../../../../engines/registry';

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Says what TwinScope will do with the inputs, then lets the user run it.
 *
 * Rule 1: never make the user choose an engine we can detect. Rule 3: when the
 * choice is surprising — two different kinds falling back to text — say why.
 *
 * Detection also runs here, purely to *describe* the choice; the engine host
 * decides for real. Duplicating it keeps the label instant.
 */
/** Over this, a text comparison is worth warning about before it starts. */
const HEAVY_BYTES = 10 * 1024 * 1024;

/**
 * An engine label as it reads mid-sentence: "Text diff" → "text", "Structural
 * YAML diff" → "structural yaml". The chip says what will run, and every engine
 * label ends in the same noun the sentence already supplies.
 */
function engineNoun(label: string): string {
  return label.replace(/\s*diff$/i, '').toLowerCase();
}

export function DetectedBar() {
  const [confirmingHeavy, setConfirmingHeavy] = useState(false);
  const a = useCompareStore((state) => state.a);
  const b = useCompareStore((state) => state.b);
  const engineOverride = useCompareStore((state) => state.engineOverride);
  const setEngineOverride = useCompareStore((state) => state.setEngineOverride);
  const runComparison = useRunComparison();
  const loadSample = useLoadSample();
  const runDemo = useRunDemo();
  const isDev = useIsDev();

  if (a === null || b === null) {
    return (
      <div className="dd-detected" data-testid="detected-bar">
        <Chip>
          {a !== null || b !== null
            ? `Waiting for the ${a !== null ? 'AFTER' : 'BEFORE'} side…`
            : 'Drop, browse or paste two inputs'}
        </Chip>
        <Button variant="ghost" data-testid="sample-button" onClick={() => void loadSample()}>
          Load sample comparison
        </Button>
        {/* Development builds only — the pipeline fixture, never shipped. */}
        {isDev && (
          <Button variant="ghost" data-testid="demo-button" onClick={() => void runDemo()}>
            Demo engine
          </Button>
        )}
      </div>
    );
  }

  // Size and path travel too: large-file mode (v0.2.8) claims a pair *because* of
  // its size, and without them this bar would name `text` while the worker ran
  // `text-large`.
  const detected = selectEngineForInputs(
    {
      name: a.name,
      kind: a.kind,
      size: a.size,
      ...(a.path !== undefined ? { path: a.path } : {}),
      ...(a.text !== undefined ? { text: a.text } : {}),
    },
    {
      name: b.name,
      kind: b.kind,
      size: b.size,
      ...(b.path !== undefined ? { path: b.path } : {}),
      ...(b.text !== undefined ? { text: b.text } : {}),
    },
  );

  const [kindA, kindB] = detected.kinds;
  const mismatched = kindA !== kindB;
  const chosen = engineOverride ?? detected.engine?.meta.id ?? null;
  const chosenLabel =
    ENGINES.find((engine) => engine.meta.id === chosen)?.meta.label ??
    detected.engine?.meta.label ??
    'no engine';

  return (
    <div className="dd-detected" data-testid="detected-bar">
      <Chip variant="acc">
        Detected: {mismatched ? `${kindA} + ${kindB}` : kindA} → {chosenLabel}
      </Chip>

      {mismatched && (
        <Chip variant="info">
          {/* Rule 3: an unexpected engine choice has to explain itself — and it
              has to say what will actually run. Two different kinds do not always
              fall through to text: since v0.2.3 a YAML against a JSON compares
              structurally, because YAML is a superset of JSON. */}
          Different kinds — comparing as {engineNoun(chosenLabel)}
        </Chip>
      )}

      {engineOverride !== null && <Chip variant="mod">manual override</Chip>}

      {/* A multi-megabyte text pair is slow enough to be worth a heads-up rather
          than a spinner that looks like a hang (MD §31). */}
      {confirmingHeavy ? (
        <>
          <Chip variant="mod">
            {formatSize(Math.max(a.size, b.size))} of text — this may take a few seconds
          </Chip>
          <Button
            variant="primary"
            data-testid="confirm-heavy"
            onClick={() => {
              setConfirmingHeavy(false);
              void runComparison();
            }}
          >
            Compare anyway
          </Button>
          <Button variant="ghost" onClick={() => setConfirmingHeavy(false)}>
            Cancel
          </Button>
        </>
      ) : (
        <Button
          variant="primary"
          data-testid="compare-button"
          disabled={chosen === null}
          onClick={() => {
            const heavy =
              chosen !== 'folder' &&
              chosen !== 'image' &&
              // v0.2.8: large-file mode is *for* these sizes — it indexes rather
              // than reads, so warning that it may take a few seconds would be
              // warning about the thing that stopped being slow.
              chosen !== 'text-large' &&
              Math.max(a.size, b.size) > HEAVY_BYTES;
            if (heavy) setConfirmingHeavy(true);
            else void runComparison();
          }}
        >
          Compare <Kbd>⏎</Kbd>
        </Button>
      )}

      <label>
        <span className="dd-sr-only">Comparison engine</span>
        <select
          className="dd-selectish"
          data-testid="engine-select"
          value={engineOverride ?? ''}
          onChange={(event) => setEngineOverride(event.target.value || null)}
        >
          <option value="">Auto ({detected.engine?.meta.label ?? 'none'})</option>
          {ENGINES.map((engine) => (
            <option key={engine.meta.id} value={engine.meta.id}>
              {engine.meta.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
