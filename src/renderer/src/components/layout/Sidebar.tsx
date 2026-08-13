import { Chip, FileTypeBadge } from '../primitives';
import { badgeForKind } from '../../lib/historyView';
import { openSavedComparison } from '../../lib/savedComparisons';
import { useAppStore, type View } from '../../stores/app';
import { useProjectsStore } from '../../stores/projects';
import { CompareIcon, HistoryIcon, ProjectsIcon, SettingsIcon } from './icons';

interface NavEntry {
  view: View;
  label: string;
  shortcut: string;
  icon: React.ReactNode;
  /** Kept for a destination that exists but cannot be used yet. */
  disabled?: boolean;
}

const NAV: readonly NavEntry[] = [
  { view: 'compare', label: 'Compare', shortcut: '⌘1', icon: <CompareIcon /> },
  { view: 'history', label: 'History', shortcut: '⌘2', icon: <HistoryIcon /> },
  // v0.2.9: Projects is a real screen now, and stopped saying `soon`.
  { view: 'projects', label: 'Projects', shortcut: '⌘3', icon: <ProjectsIcon /> },
  { view: 'settings', label: 'Settings', shortcut: '⌘,', icon: <SettingsIcon /> },
];

/** How many saved comparisons the rail shows before Projects is the place to look. */
const PINNED_LIMIT = 3;

export function Sidebar() {
  const view = useAppStore((state) => state.view);
  const setView = useAppStore((state) => state.setView);
  const saved = useProjectsStore((state) => state.saved);
  const pinned = saved.slice(0, PINNED_LIMIT);

  return (
    <nav className="dd-sidebar" aria-label="Primary" data-testid="sidebar">
      <div className="dd-group-label">Workspace</div>
      {NAV.map((entry) => (
        <button
          key={entry.view}
          type="button"
          className="dd-navitem"
          aria-current={view === entry.view ? 'page' : undefined}
          disabled={entry.disabled}
          onClick={() => setView(entry.view)}
          data-testid={`nav-${entry.view}`}
        >
          {entry.icon}
          {entry.label}
          {entry.disabled ? (
            <span className="dd-shortcut">
              <Chip>soon</Chip>
            </span>
          ) : (
            <span className="dd-shortcut">{entry.shortcut}</span>
          )}
        </button>
      ))}

      {/* v0.2.9: real saved comparisons, live. This was three disabled fixtures
          captioned "placeholder until saved comparisons exist" — they exist now, so
          the rail either shows them or shows nothing. */}
      {pinned.length > 0 && (
        <>
          <div className="dd-group-label">Saved</div>
          {pinned.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className="dd-navitem"
              data-testid={`pinned-${entry.id}`}
              onClick={() => void openSavedComparison(entry)}
            >
              <FileTypeBadge kind={badgeForKind(entry.a.kind)} />
              {entry.name}
            </button>
          ))}
        </>
      )}

      <div className="dd-sidebar-spacer" />

      <div className="dd-privacy" data-testid="privacy-badge">
        <div className="dd-privacy-title">
          <span className="dd-privacy-dot" aria-hidden="true" />
          Local only
        </div>
        <p>No telemetry. No uploads. Your files stay on your machine.</p>
      </div>
    </nav>
  );
}
