import { expect, test } from '@playwright/test';
import { freshWorkDir, imagePair } from './helpers/fixtures';
import { openPair, stage, still, tile } from './helpers/stage';

/** The four viewing modes, in the order the toolbar offers them. */
const MODES = ['Side-by-side', 'Overlay', 'Blink', 'Difference'] as const;

/**
 * MEDIA-1 stills for the image engine.
 *
 * `image-four-modes` is shot as four tiles — each one crops the toolbar with the
 * mode switcher *and* the stage, so every tile says which mode it is — and
 * `scripts/make-media.mjs` composites them into one 2×2 still.
 */
test('stills: image modes and region boxes', async () => {
  const harness = await stage();
  const dir = freshWorkDir('image');

  try {
    await openPair(harness, imagePair(dir));
    await expect(harness.page.getByTestId('detected-bar')).toContainText('Visual / pixel diff');
    await harness.page.getByTestId('compare-button').click();

    const stageEl = harness.page.getByTestId('image-stage');
    await expect(stageEl).toBeVisible();
    // Three separated changes in the fixture pair — one recoloured card accent,
    // one moved badge, one taller bar.
    await expect(stageEl.locator('.dd-region')).toHaveCount(3);

    const panes = stageEl.locator('.dd-shotwrap');

    for (const mode of MODES) {
      await harness.page.getByRole('tab', { name: mode }).click();
      if (mode === 'Blink') {
        // Blink alternates on a 1.1s timer starting from the BEFORE image; wait
        // past the first flip so the tile is the after frame every run instead
        // of whichever frame the shot happened to land on.
        await harness.page.waitForTimeout(1250);
      }
      // Toolbar and strip in frame so each tile names its own mode; the panes
      // rather than the whole stage, which is mostly empty at a fitted zoom.
      await tile(harness, `image-mode-${mode.toLowerCase()}`, {
        clip: ['workspace-toolbar', 'summary-strip', panes.first(), panes.last()],
        pad: 10,
      });
    }

    // Zoomed in, so the region boxes are clearly on their own pixels and the
    // zoom readout is showing a real number rather than "Fit".
    await harness.page.getByRole('tab', { name: 'Side-by-side' }).click();
    await harness.page.getByRole('button', { name: '1:1' }).click();
    await expect(harness.page.getByTestId('zoom-value')).toHaveText('100%');
    await harness.page.keyboard.press('Alt+ArrowDown');
    await expect(harness.page.getByTestId('change-position')).toHaveText('1 / 3');
    await still(harness, 'image-regions-zoom', { statusBar: false });

    expect(harness.errors, `errors:\n${harness.errors.join('\n')}`).toEqual([]);
  } finally {
    await harness.close();
  }
});
