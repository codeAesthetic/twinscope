import { DropZone } from './DropZone';
import { SwapControl } from './SwapControl';
import { useCompareStore } from '../../stores/compare';
import { useIntake } from '../../lib/intake';
import type { InputPayload } from '../../../../shared/channels';

/**
 * The two inputs side by side.
 *
 * With `static` it renders whatever it is given and stays inert — that is how
 * the `#gallery` shows the filled state without a filesystem. Otherwise it is
 * driven by the compare store and the native pickers.
 */
export function DropZonePair({
  staticBefore,
  staticAfter,
  isStatic = false,
}: {
  staticBefore?: InputPayload;
  staticAfter?: InputPayload;
  isStatic?: boolean;
}) {
  const a = useCompareStore((state) => state.a);
  const b = useCompareStore((state) => state.b);
  const setInput = useCompareStore((state) => state.setInput);
  const swap = useCompareStore((state) => state.swap);
  const { fromDrop } = useIntake();

  if (isStatic) {
    return (
      <div className="dd-dropgrid" data-testid="drop-pair">
        <DropZone side="BEFORE" input={staticBefore ?? null} />
        <SwapControl />
        <DropZone side="AFTER" input={staticAfter ?? null} />
      </div>
    );
  }

  const pick = async (side: 'A' | 'B', kind: 'file' | 'folder'): Promise<void> => {
    const picked =
      kind === 'file'
        ? await window.devdiff.dialog.pickFile(side)
        : await window.devdiff.dialog.pickFolder(side);
    // null means the user cancelled the dialog — leave the slot untouched.
    if (picked !== null) setInput(side, picked);
  };

  return (
    <div className="dd-dropgrid" data-testid="drop-pair">
      <DropZone
        side="BEFORE"
        input={a}
        onPickFile={() => void pick('A', 'file')}
        onPickFolder={() => void pick('A', 'folder')}
        onClear={() => setInput('A', null)}
        onDrop={(dataTransfer) => void fromDrop('A', dataTransfer)}
      />
      <SwapControl onSwap={swap} />
      <DropZone
        side="AFTER"
        input={b}
        onPickFile={() => void pick('B', 'file')}
        onPickFolder={() => void pick('B', 'folder')}
        onClear={() => setInput('B', null)}
        onDrop={(dataTransfer) => void fromDrop('B', dataTransfer)}
      />
    </div>
  );
}
