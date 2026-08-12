import { useEffect, useState } from 'react';
import { AppFrame } from './components/layout/AppFrame';
import { CommandPalette } from './components/CommandPalette';
import { useActions } from './lib/actions';
import { useCompareEvents, useRunComparison } from './lib/compareClient';
import { useAppShortcuts, useClipboardIntake } from './lib/intake';
import { useAppStore } from './stores/app';
import { CompareScreen } from './screens/CompareScreen';
import { Gallery } from './screens/Gallery';
import { HistoryScreen } from './screens/HistoryScreen';
import { Placeholder } from './screens/Placeholder';
import { SettingsScreen } from './screens/SettingsScreen';
import { WorkspaceScreen } from './screens/WorkspaceScreen';
import { ThemeProvider } from './theme/ThemeProvider';

function CurrentScreen() {
  const view = useAppStore((state) => state.view);

  switch (view) {
    case 'compare':
      return <CompareScreen />;
    case 'workspace':
      return <WorkspaceScreen />;
    case 'history':
      return <HistoryScreen />;
    case 'projects':
      return <Placeholder name="Projects" note="Scoped at v0.2.9." />;
    case 'settings':
      return <SettingsScreen />;
  }
}

/**
 * Everything that needs the app's context, one level inside the provider.
 *
 * These hooks cannot live in `App`: `useActions` reaches for the theme, and a
 * component cannot consume a context it is itself rendering.
 */
function Shell() {
  // Subscribed once at the root: a per-screen subscription would drop events
  // whenever the user navigated mid-comparison.
  useCompareEvents();

  // The keyboard map (MD §10), from the single registry in lib/shortcuts.ts.
  const runComparison = useRunComparison();
  const onAction = useActions();
  useAppShortcuts(() => void runComparison(), onAction);
  // Plain ⌘V, via the platform's paste event (⌘⇧V is the explicit binding).
  useClipboardIntake();

  return (
    <>
      <AppFrame>
        <CurrentScreen />
      </AppFrame>
      <CommandPalette onAction={onAction} />
    </>
  );
}

/**
 * No router (plan D11) — the sidebar drives a Zustand `view`.
 *
 * Two dev-facing hash routes: #gallery for the design system, and #workspace to
 * reach the comparison chassis before a real comparison can open it.
 */
export function App() {
  const [hash, setHash] = useState(() => window.location.hash);
  const setView = useAppStore((state) => state.setView);

  useEffect(() => {
    const onHashChange = (): void => setHash(window.location.hash);
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => {
    if (hash === '#workspace') setView('workspace');
  }, [hash, setView]);

  return <ThemeProvider>{hash === '#gallery' ? <Gallery /> : <Shell />}</ThemeProvider>;
}
