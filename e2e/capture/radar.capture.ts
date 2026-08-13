import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { copyFixtureTree, freshWorkDir } from './helpers/fixtures';
import { openPair, stage, still } from './helpers/stage';

/**
 * MEDIA-1 still for the Diff Radar (v0.2.7).
 *
 * The subject of this picture is **an absence**, exactly like `config-masked`'s: what
 * it has to show is that an axis the engine could not measure is drawn as a hollow
 * ring at the centre and named in words — never as a zero, which would claim that
 * nothing changed on that axis when in fact nothing was looked at.
 *
 * The pair is chosen for that, not for a pretty polygon. Two `package.json`
 * **manifests** give the deps engine three axes it can measure (Deps, Structure,
 * Content) and three it cannot: a manifest declares ranges rather than resolving
 * them, so there are no licences to compare (Metadata) and no transitive count to
 * weigh (Weight), and no comparison of two text files has anything to say about
 * pixels (Visual). Half the chart measured and half admitted is the whole point.
 *
 * Identical inputs are deliberately *not* used — they produce no radar object at all,
 * so there would be nothing to photograph.
 *
 * Both sides must keep the name `package.json` for detection to route the pair to the
 * deps engine (it reads the basename, not the extension), which is why the fixture is
 * two trees rather than two files.
 */

/** Measured by a manifest pair — filled dots, and a legend key carrying a score. */
const MEASURED = ['structure', 'content', 'dependencies'] as const;

/** Not measurable from two manifests — hollow at the centre, and named as such. */
const ABSENT = ['visual', 'metadata', 'performance'] as const;

/**
 * `DiffRadar`'s centre, from the approved mockup's `#radarbox`.
 *
 * An absent axis is plotted at factor 0, which puts it here whatever its angle —
 * so this pair of attributes is the assertion that the drawing does not imply a
 * score. Checked as strings because that is what the SVG attribute carries.
 */
const CENTRE = { cx: '112.0', cy: '108.0' };

test('stills: the radar names the three axes a manifest pair cannot measure', async () => {
  const harness = await stage();
  const dir = freshWorkDir('radar');

  try {
    const before = copyFixtureTree('deps/manifest/before', dir);
    const after = copyFixtureTree('deps/manifest/after', dir);

    await openPair(harness, {
      before: join(before, 'package.json'),
      after: join(after, 'package.json'),
    });
    await expect(harness.page.getByTestId('detected-bar')).toContainText('Dependency diff');
    await harness.page.getByTestId('compare-button').click();
    await expect(harness.page.getByTestId('deps-view')).toBeVisible();

    // The counts in the frame are part of the asset, so pin them.
    const strip = harness.page.getByTestId('summary-strip');
    await expect(strip).toContainText('＋1 added');
    await expect(strip).toContainText('－2 removed');
    await expect(strip).toContainText('～4 modified');

    // ---------- collapsed by default: most comparisons are read by their numbers ----------
    const toggle = harness.page.getByTestId('radar-toggle');
    await expect(toggle).toBeVisible();
    await expect(harness.page.getByTestId('diff-radar')).toHaveCount(0);

    await toggle.click();
    const radar = harness.page.getByTestId('diff-radar');
    await expect(radar).toBeVisible();

    // ---------- three axes are measured, and only those carry a number ----------
    for (const axis of MEASURED) {
      const dot = radar.getByTestId(`radar-dot-${axis}`);
      await expect(dot).toHaveAttribute('data-measured', 'true');
      await expect(radar.getByTestId(`radar-key-${axis}`)).toBeVisible();
      // A filled dot, so the two kinds of point differ in the pixels and not only
      // in an attribute a screenshot cannot show.
      await expect(dot).not.toHaveCSS('fill', 'none');
    }

    // ---------- and three are absent: hollow, at the centre, without a score ----------
    for (const axis of ABSENT) {
      const dot = radar.getByTestId(`radar-dot-${axis}`);
      await expect(dot).toHaveAttribute('data-measured', 'false');
      await expect(dot).toHaveAttribute('cx', CENTRE.cx);
      await expect(dot).toHaveAttribute('cy', CENTRE.cy);
      await expect(dot).toHaveCSS('fill', 'none');
      // No legend key exists for an axis nobody scored — a `0` chip would be the
      // same lie in text.
      await expect(radar.getByTestId(`radar-key-${axis}`)).toHaveCount(0);
    }

    // ---------- said in words too, since a hollow ring is a convention ----------
    await expect(harness.page.getByTestId('radar-missing')).toHaveText(
      'Not measured by this comparison: Visual, Metadata, Weight.',
    );

    // Edge to edge on purpose: both bars carry their own padding, and any positive
    // pad here reaches past the radar bar's divider into the view's toolbar below it.
    await still(harness, 'radar-axes', { clip: ['summary-strip', 'diff-radar'], pad: 0 });

    expect(harness.errors, `errors:\n${harness.errors.join('\n')}`).toEqual([]);
  } finally {
    await harness.close();
  }
});
