import { useEffect, type ReactNode } from 'react';

/**
 * The app's one transient message (MVP-11).
 *
 * Both surfaces that had grown their own — export's "Report saved" and the JSON
 * view's "Path copied" — now render this, so a toast cannot appear in two
 * different shapes depending on which feature produced it.
 */
export function Toast({
  message,
  action,
  onDismiss,
  timeoutMs = 6000,
  testId = 'toast',
}: {
  message: string;
  /** Optional trailing control, e.g. Reveal. */
  action?: ReactNode;
  onDismiss: () => void;
  timeoutMs?: number;
  testId?: string;
}) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, timeoutMs);
    return () => clearTimeout(timer);
  }, [onDismiss, timeoutMs, message]);

  return (
    <div className="dd-toast" role="status" data-testid={testId}>
      <span>{message}</span>
      {action}
    </div>
  );
}
