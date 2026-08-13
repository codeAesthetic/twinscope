import { expect, test } from '@playwright/test';
import { copyFixture, freshWorkDir } from './helpers/fixtures';
import { openPair, stage, still } from './helpers/stage';

/**
 * MEDIA-1 still for the page engine (v0.3.2).
 *
 * One asset, because a page comparison is one answer in four parts: the section
 * switcher carries its own counts, so a single shot of the Structure section also
 * shows how much Style, Assets and Accessibility have to say. The counts are
 * asserted to be non-zero before the shot — a switcher reading `(0)` would
 * photograph a fixture that stopped exercising three quarters of the engine.
 *
 * The pair goes in through the real picker so both sides carry `.html` names and
 * detection routes them to the page engine rather than line-diffing them.
 */
test('stills: page diff — structure, style, assets and accessibility', async () => {
  const harness = await stage();
  expect(harness.target).toBe('app');
  const dir = freshWorkDir('web');

  try {
    await openPair(harness, {
      before: copyFixture('web/landing.before.html', dir),
      after: copyFixture('web/landing.after.html', dir),
    });
    await expect(harness.page.getByTestId('detected-bar')).toContainText('Page diff');

    await harness.page.getByTestId('compare-button').click();

    const view = harness.page.getByTestId('web-view');
    await expect(view).toBeVisible();

    // Every section has something to say, and the strip says how much.
    const strip = harness.page.getByTestId('summary-strip');
    for (const section of ['structure', 'style', 'assets', 'a11y']) {
      await expect(strip).toContainText(section);
    }
    // `(0)` in the switcher would mean the fixture no longer reaches that section.
    for (const label of ['Structure', 'Style', 'Assets', 'Accessibility']) {
      await expect(
        harness.page.getByRole('tab', { name: new RegExp(`^${label} \\([1-9]`) }),
      ).toBeVisible();
    }

    // The view opens on the first section with content, which is Structure.
    await expect(view).toHaveAttribute('data-section', 'structure');
    await expect(view).toContainText('text changed');
    await expect(view).toContainText('£39.98');

    /*
     * The two card headings went from <h2> to <h3>, and this pair does **not** fold
     * them into one "became <h3>" row — each arrives as `<h2> gone` plus `<h3> added`.
     *
     * That is the engine's real behaviour here, not a fixture problem, so it is
     * asserted rather than avoided. `pairRetaggedNodes` recognises a retag by the
     * tag-free `position` slot, and `position` is a path of *sibling indices*: the
     * AFTER page inserts `<div class="banner">` before `<main>`, which shifts every
     * position beneath it by one, so the removal and the addition no longer look like
     * the same slot. Keys are unaffected, which is why every other row still pairs.
     */
    await expect(view.locator('tr[data-state="removed"]', { hasText: '<h2> gone' })).toHaveCount(2);
    await expect(view.locator('tr[data-state="added"]', { hasText: '<h3> added' })).toHaveCount(2);

    await still(harness, 'web-sections', { statusBar: false });

    // Not photographed, but asserted in the same run: the other three sections are
    // real answers rather than empty tabs behind a count.
    await harness.page.getByRole('tab', { name: /^Style/ }).click();
    await expect(view).toContainText('.card');

    await harness.page.getByRole('tab', { name: /^Assets/ }).click();
    await expect(view).toContainText('/assets/tracking.5f5f5f.js');

    /*
     * The rebuilt bundle is **not** folded into one "same asset, different URL" row
     * either, and for a nearby reason: `fingerprintUrl` masks a hash-looking run of
     * eight-or-more hex characters, or six-or-more digits. This fixture's hashes are
     * six characters, so `app.998877.css` masks (all digits) while `app.a1b2c3.css`
     * does not (six hex is under the bound) — the two fingerprints differ and the pair
     * reads as one asset gone and one arrived. Five rows, not three.
     */
    const assetRows = view.locator('tbody tr');
    await expect(assetRows).toHaveCount(5);
    await expect(view.locator('tr[data-state="changed"]')).toHaveCount(0);

    await harness.page.getByRole('tab', { name: /^Accessibility/ }).click();
    // The lamp lost its alt text, and the search box arrived with no label — the two
    // changes in this pair only the accessibility section can see.
    await expect(view.locator('[data-concern="true"]').first()).toBeVisible();
    await expect(view).toContainText('h1 h2 h2');
    await expect(view).toContainText('h1 h3 h3');

    expect(harness.errors, `errors:\n${harness.errors.join('\n')}`).toEqual([]);
  } finally {
    await harness.close();
  }
});
