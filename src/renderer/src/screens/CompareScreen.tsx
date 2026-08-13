import { useState } from 'react';
import { DetectedBar } from '../components/home/DetectedBar';
import { DropZonePair } from '../components/home/DropZonePair';
import { GitPanel } from '../components/home/GitPanel';
import { QuickCards } from '../components/home/QuickCards';
import { RecentList } from '../components/home/RecentList';
import { Button, Chip } from '../components/primitives';
import { useActions } from '../lib/actions';
import { useAppStore } from '../stores/app';

/**
 * The Compare screen — the app's front door (MD §9): hero, drop zones, swap
 * control, detection bar, quick-start cards and recent comparisons.
 */
export function CompareScreen() {
  const notice = useAppStore((state) => state.notice);
  const setNotice = useAppStore((state) => state.setNotice);
  // The git panel is a mode of this screen rather than a route: it produces two
  // inputs and then hands them to the same pipeline the drop zones use.
  const [gitOpen, setGitOpen] = useState(false);
  const runAction = useActions();

  return (
    <div className="dd-home" data-testid="screen-compare">
      <h1 className="dd-home-title">What do you want to compare?</h1>
      <p className="dd-home-sub">
        Drop anything — TwinScope detects the type and picks the right comparison.
      </p>

      {notice !== null && (
        <div className="dd-notice" role="status" data-testid="compare-notice">
          <Chip variant="mod">Cannot reopen</Chip>
          <span>{notice}</span>
          <Button variant="ghost" size="sm" aria-label="Dismiss" onClick={() => setNotice(null)}>
            ✕
          </Button>
        </div>
      )}

      <DropZonePair />
      <DetectedBar />
      {gitOpen && <GitPanel onClose={() => setGitOpen(false)} />}
      {/* A card either opens the git panel — a mode of this screen, so only this
          screen can — or runs the same action its keyboard shortcut runs. */}
      <QuickCards
        onSelect={(action) => {
          // Choosing another route closes the panel, as it did before these cards
          // were wired: it occupies this screen, and leaving it open beside a pair
          // the picker just filled would leave two ref boxes describing nothing.
          setGitOpen(action === 'git-panel');
          if (action !== 'git-panel') runAction(action);
        }}
      />
      <RecentList />
    </div>
  );
}
