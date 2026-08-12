import { DetectedBar } from '../components/home/DetectedBar';
import { DropZonePair } from '../components/home/DropZonePair';
import { QuickCards } from '../components/home/QuickCards';
import { RecentList } from '../components/home/RecentList';

/**
 * The Compare screen — the app's front door (MD §9).
 *
 * Static through Category 2: hero, drop zones, swap control, detection bar,
 * quick-start cards and recent comparisons. Real input handling lands in MVP-2
 * and real history in MVP-8.
 */
export function CompareScreen() {
  return (
    <div className="dd-home" data-testid="screen-compare">
      <h1 className="dd-home-title">What do you want to compare?</h1>
      <p className="dd-home-sub">
        Drop anything — DevDiff detects the type and picks the right comparison.
      </p>

      <DropZonePair />
      <DetectedBar />
      <QuickCards />
      <RecentList />
    </div>
  );
}
