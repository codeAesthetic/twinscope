import { DetectedBar } from '../components/home/DetectedBar';
import { DropZonePair } from '../components/home/DropZonePair';
import { QuickCards } from '../components/home/QuickCards';
import { RecentList } from '../components/home/RecentList';
import { Button, Chip } from '../components/primitives';
import { useAppStore } from '../stores/app';

/**
 * The Compare screen — the app's front door (MD §9): hero, drop zones, swap
 * control, detection bar, quick-start cards and recent comparisons.
 */
export function CompareScreen() {
  const notice = useAppStore((state) => state.notice);
  const setNotice = useAppStore((state) => state.setNotice);

  return (
    <div className="dd-home" data-testid="screen-compare">
      <h1 className="dd-home-title">What do you want to compare?</h1>
      <p className="dd-home-sub">
        Drop anything — DevDiff detects the type and picks the right comparison.
      </p>

      {notice !== null && (
        <div className="dd-notice" role="status" data-testid="compare-notice">
          <Chip variant="mod">Input missing</Chip>
          <span>{notice}</span>
          <Button variant="ghost" size="sm" aria-label="Dismiss" onClick={() => setNotice(null)}>
            ✕
          </Button>
        </div>
      )}

      <DropZonePair />
      <DetectedBar />
      <QuickCards />
      <RecentList />
    </div>
  );
}
