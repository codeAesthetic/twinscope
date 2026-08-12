import { Button, Chip, Kbd } from '../primitives';
import { useRunComparison } from '../../lib/compareClient';
import { useCompareStore } from '../../stores/compare';
import { ENGINES, selectEngineForInputs } from '../../../../engines/registry';

/**
 * Says what DevDiff will do with the inputs, then lets the user run it.
 *
 * Rule 1: never make the user choose an engine we can detect. Rule 3: when the
 * choice is surprising — two different kinds falling back to text — say why.
 *
 * Detection also runs here, purely to *describe* the choice; the engine host
 * decides for real. Duplicating it keeps the label instant.
 */
export function DetectedBar() {
  const a = useCompareStore((state) => state.a);
  const b = useCompareStore((state) => state.b);
  const engineOverride = useCompareStore((state) => state.engineOverride);
  const setEngineOverride = useCompareStore((state) => state.setEngineOverride);
  const runComparison = useRunComparison();

  if (a === null || b === null) {
    return (
      <div className="dd-detected" data-testid="detected-bar">
        <Chip>
          {a !== null || b !== null
            ? `Waiting for the ${a !== null ? 'AFTER' : 'BEFORE'} side…`
            : 'Drop, browse or paste two inputs'}
        </Chip>
        <Button
          variant="ghost"
          data-testid="demo-button"
          onClick={() => void runComparison('demo')}
        >
          Load demo comparison
        </Button>
      </div>
    );
  }

  const detected = selectEngineForInputs(
    { name: a.name, kind: a.kind, ...(a.text !== undefined ? { text: a.text } : {}) },
    { name: b.name, kind: b.kind, ...(b.text !== undefined ? { text: b.text } : {}) },
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
          {/* Rule 3: an unexpected engine choice has to explain itself. */}
          Different kinds — comparing as text
        </Chip>
      )}

      {engineOverride !== null && <Chip variant="mod">manual override</Chip>}

      <Button
        variant="primary"
        data-testid="compare-button"
        disabled={chosen === null}
        onClick={() => void runComparison()}
      >
        Compare <Kbd>⏎</Kbd>
      </Button>

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
