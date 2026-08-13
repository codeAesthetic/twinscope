import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { copyFixtureTree, freshWorkDir } from './helpers/fixtures';
import { openPair, stage, still } from './helpers/stage';

/**
 * MEDIA-1 still for the deps engine (v0.2.10).
 *
 * Detection reads the *basename*, not the extension, so both sides have to keep the
 * name `package.json` — which means each side needs its own directory. That is why
 * the fixture is two trees rather than a `before`/`after` pair of files: renaming
 * either one would route the pair to the JSON engine and photograph a structural
 * tree of two manifests, which answers the wrong question.
 */
test('stills: deps table with graded bumps, an arrival and two departures', async () => {
  const harness = await stage();
  const dir = freshWorkDir('deps');

  try {
    const before = copyFixtureTree('deps/manifest/before', dir);
    const after = copyFixtureTree('deps/manifest/after', dir);

    await openPair(harness, {
      before: join(before, 'package.json'),
      after: join(after, 'package.json'),
    });
    await expect(harness.page.getByTestId('detected-bar')).toContainText('Dependency diff');
    await harness.page.getByTestId('compare-button').click();

    const view = harness.page.getByTestId('deps-view');
    await expect(view).toBeVisible();

    const strip = harness.page.getByTestId('summary-strip');
    // undici arrived; node-fetch and lodash went; four packages moved version.
    await expect(strip).toContainText('＋1 added');
    await expect(strip).toContainText('－2 removed');
    await expect(strip).toContainText('～4 modified');
    await expect(strip).toContainText('3 major');

    // Severity, not just "changed": the grading is the reason this is a table and
    // not a text diff of two manifests.
    await expect(harness.page.getByTestId('deps-bump-express')).toHaveText('major');
    await expect(harness.page.getByTestId('deps-bump-pino')).toHaveText('minor');
    await expect(harness.page.getByTestId('deps-bump-typescript')).toHaveText('major');
    await expect(view.locator('[data-name="undici"]')).toHaveAttribute('data-status', 'add');
    await expect(view.locator('[data-name="node-fetch"]')).toHaveAttribute('data-status', 'del');

    // Two manifests can only show declared ranges, and the view says so — a caveat
    // in the frame is worth more than a caption on the website.
    await expect(harness.page.getByTestId('deps-declared')).toContainText('declared ranges only');

    await still(harness, 'deps-table', { statusBar: false });

    expect(harness.errors, `errors:\n${harness.errors.join('\n')}`).toEqual([]);
  } finally {
    await harness.close();
  }
});
