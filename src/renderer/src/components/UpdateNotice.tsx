import { useEffect } from 'react';
import { Button } from './primitives';
import { Toast } from './Toast';
import { useUpdateStore } from '../stores/update';

/**
 * The launch notice for an available update (v0.2.13).
 *
 * It reuses the app's one transient message rather than adding a banner to a
 * mockup-approved frame: the persistent truth lives in Settings, which says what
 * the last check found and when, so nothing is lost when this fades. The check
 * itself is main's — this component subscribes and never asks for one, so with
 * the preference off there is nothing to show and no request was made.
 *
 * Mounted once in `Shell`, beside the palette: a per-screen mount would miss the
 * push whenever the user happened to be on another screen when it arrived.
 */
export function UpdateNotice() {
  const state = useUpdateStore((store) => store.state);
  const dismissed = useUpdateStore((store) => store.dismissed);
  const apply = useUpdateStore((store) => store.apply);
  const load = useUpdateStore((store) => store.load);
  const dismiss = useUpdateStore((store) => store.dismiss);
  const open = useUpdateStore((store) => store.open);

  useEffect(() => {
    // Both halves are needed: the subscription catches a check that finishes
    // later, and the read catches one that finished before this mounted.
    const unsubscribe = window.twinscope.update.onState(apply);
    void load();
    return unsubscribe;
  }, [apply, load]);

  if (state.status !== 'available' || dismissed) return null;

  return (
    <Toast
      testId="update-toast"
      message={`TwinScope ${state.latest} is available — you have ${state.current}.`}
      // Longer than the default six seconds: this is not an acknowledgement of
      // something the user just did, it is news they did not ask for yet.
      timeoutMs={20_000}
      onDismiss={dismiss}
      action={
        <Button
          size="sm"
          variant="primary"
          data-testid="update-open"
          onClick={() => {
            void open();
            dismiss();
          }}
        >
          Release notes
        </Button>
      }
    />
  );
}
