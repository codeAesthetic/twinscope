import { useEffect, useState } from 'react';
import { BootScreen } from './screens/BootScreen';
import { Gallery } from './screens/Gallery';
import { ThemeProvider } from './theme/ThemeProvider';

/**
 * No router yet (plan D11) — screens switch on state. The only route today is
 * the dev-facing #gallery, used to compare primitives against the mockup.
 */
export function App() {
  const [hash, setHash] = useState(() => window.location.hash);

  useEffect(() => {
    const onHashChange = (): void => setHash(window.location.hash);
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  return <ThemeProvider>{hash === '#gallery' ? <Gallery /> : <BootScreen />}</ThemeProvider>;
}
