import { expect, test } from '@playwright/test';
import { openPalette, pasteInput } from '../helpers/seed';
import { copyFixture, freshWorkDir } from './helpers/fixtures';
import { openPair, stage, still } from './helpers/stage';

/**
 * MEDIA-1 stills for the app frame: the landing screen, the palette, Settings,
 * and the three states of the detection bar.
 *
 * One launch covers all of them, and the order is load-bearing — `landing-hero`
 * has to be shot before anything fills the drop zones or the recent list.
 */
const PROSE = [
  'Release 2.0.0',
  '',
  'The client now retries four times instead of two, and the request timeout',
  'moved from five seconds to eight. Nothing else in the public surface changed.',
].join('\n');

test('stills: landing, palette, settings, detection states', async () => {
  const harness = await stage();
  const dir = freshWorkDir('home');

  try {
    // ---------- the empty Compare screen ----------
    await expect(harness.page.getByTestId('recent-empty')).toBeVisible();
    await still(harness, 'landing-hero');

    // ---------- ⌘K with a query typed, and the list narrowed ----------
    await openPalette(harness);
    await harness.page.getByTestId('palette-input').fill('comp');
    await expect(harness.page.getByTestId('palette-count')).toContainText(' of ');
    await expect(harness.page.getByTestId('palette-open-files')).toBeVisible();
    await still(harness, 'palette-filtered');
    await harness.page.keyboard.press('Escape');

    // ---------- Settings ----------
    await harness.page.keyboard.press('Meta+Comma');
    await expect(harness.page.getByTestId('screen-settings')).toBeVisible();
    await still(harness, 'settings-general');

    const grid = harness.page.getByTestId('shortcuts-grid');
    await grid.scrollIntoViewIfNeeded();
    await still(harness, 'settings-shortcuts', { clip: [grid], pad: 20 });

    // ---------- detection: resolved, overridden, mismatched ----------
    await harness.page.keyboard.press('Meta+1');
    const detected = harness.page.getByTestId('detected-bar');
    const bar = { clip: ['drop-pair', 'detected-bar'], pad: 16 } as const;

    await openPair(harness, {
      before: copyFixture('json/users.v1.json', dir),
      after: copyFixture('json/users.v2.json', dir),
    });
    await expect(detected).toContainText('Structural JSON diff');
    await still(harness, 'detection-bar', { ...bar });

    await harness.page.getByTestId('engine-select').selectOption('text');
    await expect(detected).toContainText('manual override');
    await still(harness, 'detection-override', { ...bar });
    await harness.page.getByTestId('engine-select').selectOption('');

    // Two different kinds fall back to text, and the bar has to say why.
    await harness.page.getByTestId('clear-after').click();
    await pasteInput(harness, PROSE, 'after');
    await expect(detected).toContainText('Different kinds — comparing as text');
    await still(harness, 'detection-mismatch', { ...bar });

    expect(harness.errors, `errors:\n${harness.errors.join('\n')}`).toEqual([]);
  } finally {
    await harness.close();
  }
});
