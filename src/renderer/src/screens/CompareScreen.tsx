import { DetectedBar } from '../components/home/DetectedBar';
import { DropZonePair } from '../components/home/DropZonePair';

/**
 * The Compare screen — the app's front door (MD §9).
 *
 * HOME-2 builds it static: hero, both drop zones, swap control and the
 * detection bar. Quick-start cards and recent comparisons land in HOME-3;
 * real input handling in MVP-2.
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
    </div>
  );
}
