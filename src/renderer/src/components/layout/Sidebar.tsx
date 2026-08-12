import { Chip, FileTypeBadge } from '../primitives';
import { useAppStore, type View } from '../../stores/app';
import { CompareIcon, HistoryIcon, ProjectsIcon, SettingsIcon } from './icons';

interface NavEntry {
  view: View;
  label: string;
  shortcut: string;
  icon: React.ReactNode;
  /** Projects has no MVP definition yet — it ships visible but disabled. */
  disabled?: boolean;
}

const NAV: readonly NavEntry[] = [
  { view: 'compare', label: 'Compare', shortcut: '⌘1', icon: <CompareIcon /> },
  { view: 'history', label: 'History', shortcut: '⌘2', icon: <HistoryIcon /> },
  { view: 'projects', label: 'Projects', shortcut: '', icon: <ProjectsIcon />, disabled: true },
  { view: 'settings', label: 'Settings', shortcut: '⌘,', icon: <SettingsIcon /> },
];

/** Placeholder until saved comparisons exist (v0.2.0-9). */
const PINNED = [
  { kind: 'image' as const, label: 'Homepage regression' },
  { kind: 'json' as const, label: '/users contract' },
  { kind: 'folder' as const, label: 'v2.3.0 ↔ v2.4.0' },
];

export function Sidebar() {
  const view = useAppStore((state) => state.view);
  const setView = useAppStore((state) => state.setView);

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

      <div className="dd-group-label">Pinned</div>
      {PINNED.map((pin) => (
        <button key={pin.label} type="button" className="dd-navitem" disabled>
          <FileTypeBadge kind={pin.kind} />
          {pin.label}
        </button>
      ))}

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
