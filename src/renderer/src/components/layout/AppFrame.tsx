import type { ReactNode } from 'react';
import { BridgeStatus } from './BridgeStatus';
import { Sidebar } from './Sidebar';
import { StatusBar } from './StatusBar';
import { TitleBar } from './TitleBar';

/**
 * The shell every screen renders inside: titlebar / sidebar+stage / status bar.
 * Matches the mockup's window chrome.
 */
export function AppFrame({
  children,
  title,
  status,
}: {
  children: ReactNode;
  title?: ReactNode;
  status?: { left?: ReactNode; right?: ReactNode };
}) {
  return (
    <div className="dd-frame">
      <TitleBar title={title} />
      <div className="dd-body">
        <Sidebar />
        <main className="dd-stage" data-testid="stage">
          {children}
        </main>
      </div>
      <StatusBar left={status?.left} right={status?.right ?? <BridgeStatus />} />
    </div>
  );
}
