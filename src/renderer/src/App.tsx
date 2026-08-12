import { useEffect, useState } from 'react';
import { AppFrame } from './components/layout/AppFrame';
import { useAppStore } from './stores/app';
import { CompareScreen } from './screens/CompareScreen';
import { Gallery } from './screens/Gallery';
import { Placeholder } from './screens/Placeholder';
import { ThemeProvider } from './theme/ThemeProvider';

function CurrentScreen() {
  const view = useAppStore((state) => state.view);

  switch (view) {
    case 'compare':
      return <CompareScreen />;
    case 'history':
      return <Placeholder name="History" note="Recent and saved comparisons arrive in HOME-4." />;
    case 'projects':
      return <Placeholder name="Projects" note="Scoped at V1-9." />;
    case 'settings':
      return <Placeholder name="Settings" note="Settings groups arrive in HOME-4." />;
  }
}

/**
 * No router (plan D11) — the sidebar drives a Zustand `view`. The only special
 * route is the dev-facing #gallery, used to check primitives against the mockup.
 */
export function App() {
  const [hash, setHash] = useState(() => window.location.hash);

  useEffect(() => {
    const onHashChange = (): void => setHash(window.location.hash);
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

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
