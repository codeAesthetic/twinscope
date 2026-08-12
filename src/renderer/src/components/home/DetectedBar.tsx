import { Button, Chip } from '../primitives';
import { useRunComparison } from '../../lib/compareClient';
import { useCompareStore } from '../../stores/compare';
import { selectEngineForInputs } from '../../../../engines/registry';

/**
 * Sits under the drop zones and says what DevDiff will do with the inputs
 * (Rule 1: detect rather than ask), then lets the user run it.
 *
 * Detection runs in the renderer purely to *describe* the choice — the engine
 * host decides for real. Duplicating it here keeps the label instant.
 */
export function DetectedBar() {
  const a = useCompareStore((state) => state.a);
  const b = useCompareStore((state) => state.b);
  const runComparison = useRunComparison();

  const ready = a !== null && b !== null;

  const detected = ready
    ? selectEngineForInputs(
        { name: a.name, kind: a.kind, ...(a.text !== undefined ? { text: a.text } : {}) },
        { name: b.name, kind: b.kind, ...(b.text !== undefined ? { text: b.text } : {}) },
      )
    : null;

  return (
    <div className="dd-detected" data-testid="detected-bar">
      {ready && detected ? (
        <>
          <Chip variant="acc">
            {detected.kinds[0] === detected.kinds[1]
              ? `Detected: ${detected.kinds[0]}`
              : `Detected: ${detected.kinds[0]} + ${detected.kinds[1]}`}
            {detected.engine ? ` → ${detected.engine.meta.label}` : ' → no engine'}
          </Chip>
          <Button
            variant="primary"
            data-testid="compare-button"
            disabled={!detected.engine}
            onClick={() => void runComparison()}
          >
            Compare
          </Button>
        </>
      ) : (
        <>
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
        </>
      )}
    </div>
  );
}
