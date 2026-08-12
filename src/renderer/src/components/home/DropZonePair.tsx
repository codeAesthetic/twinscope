import { DropZone } from './DropZone';
import { SwapControl } from './SwapControl';
import type { DropZoneInput } from './types';

export function DropZonePair({ before, after }: { before?: DropZoneInput; after?: DropZoneInput }) {
  return (
    <div className="dd-dropgrid" data-testid="drop-pair">
      <DropZone side="BEFORE" input={before} />
      <SwapControl />
      <DropZone side="AFTER" input={after} />
    </div>
  );
}
