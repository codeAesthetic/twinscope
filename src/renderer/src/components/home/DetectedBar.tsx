import { Button, Chip } from '../primitives';

/**
 * Sits under the drop zones and explains what DevDiff will do with the inputs
 * (Rule 1: detect rather than ask). Static for HOME-2 — MVP-2 replaces the copy
 * with the real detected kind, engine label and a live Compare button.
 */
export function DetectedBar() {
  return (
    <div className="dd-detected" data-testid="detected-bar">
      <Chip>Drop, browse or paste two inputs</Chip>
      <Button variant="ghost" title="Wired up in MVP-2">
        Load demo comparison
      </Button>
    </div>
  );
}
