import { useEffect, useState } from 'react';
import { AppFrame } from './components/layout/AppFrame';
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
      return <Placeholder name="Projects" note="Scoped at V1-9." />;
    case 'settings':
      return <SettingsScreen />;
  }
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

  if (hash === '#gallery') {
    return (
      <ThemeProvider>
        <Gallery />
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider>
      <AppFrame>
        <CurrentScreen />
      </AppFrame>
    </ThemeProvider>
  );
}
