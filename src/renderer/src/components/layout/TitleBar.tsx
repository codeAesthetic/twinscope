import { Kbd } from '../primitives';
import { useCompareStore } from '../../stores/compare';
import { useTheme } from '../../theme/ThemeProvider';
import { ThemeIcon } from './icons';

/**
 * Custom titlebar (the mockup draws its own chrome). The bar is a drag region;
 * buttons opt out via CSS so they stay clickable.
 *
 * On Windows the OS controls are drawn into `titleBarOverlay` by main, so there
 * is nothing to render for them here.
 */
export function TitleBar({ title }: { title?: React.ReactNode }) {
  const { toggle, theme } = useTheme();
  const a = useCompareStore((state) => state.a);
  const b = useCompareStore((state) => state.b);

  // Once there is something to compare, the window says what (MD §11).
  const comparison =
    a !== null && b !== null ? (
      <>
        <b>{a.name}</b> <span className="dd-sep">↔</span> <b>{b.name}</b>
      </>
    ) : null;

  return (
    <header className="dd-titlebar" data-platform={window.devdiff.platform} data-testid="titlebar">
      <div className="dd-titlebar-title" data-testid="titlebar-title">
        {title ?? comparison ?? <b>DevDiff</b>}
      </div>
      <div className="dd-titlebar-right">
        <Kbd>⌘K</Kbd>
        <button
          type="button"
          className="dd-iconbtn"
          onClick={toggle}
          aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
          data-testid="theme-toggle"
        >
          <ThemeIcon />
        </button>
      </div>
    </header>
  );
}
