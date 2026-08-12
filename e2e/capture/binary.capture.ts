import { expect, test } from '@playwright/test';
import { binaryPair, freshWorkDir, largeLogPair } from './helpers/fixtures';
import { openPair, stage, still } from './helpers/stage';

/**
 * MEDIA-1 stills for the two states that are about *not* showing a diff: a
 * binary verdict, and a comparison still running.
 */
test('stills: binary verdict', async () => {
  const harness = await stage();
  const dir = freshWorkDir('binary');

  try {
    await openPair(harness, binaryPair(dir));
    await expect(harness.page.getByTestId('detected-bar')).toContainText('Binary comparison');
    await harness.page.getByTestId('compare-button').click();

    const view = harness.page.getByTestId('binary-view');
    await expect(view).toBeVisible();
    await expect(view).toContainText('These files are different');

    await still(harness, 'binary-verdict', { statusBar: false });

    expect(harness.errors, `errors:\n${harness.errors.join('\n')}`).toEqual([]);
  } finally {
    await harness.close();
  }
});

/**
 * Progress and cancellation, photographed on a pair big enough to actually take
 * a moment.
 *
 * The wait is for the text engine's **45%** step rather than "any progress": the
 * engine reports 10 → 45 → 100, so pinning the shot to a reported step is what
 * makes the percentage in the picture the same on every run.
 */
test('stills: a comparison in progress, with cancel', async () => {
  const harness = await stage();
  const dir = freshWorkDir('progress');

  try {
    await openPair(harness, largeLogPair(dir));
    await harness.page.getByTestId('compare-button').click();

    await expect(harness.page.getByTestId('job-progress')).toBeVisible();
    const label = harness.page.getByTestId('progress-label');
    await expect(label).toContainText('45%');
    await expect(harness.page.getByTestId('cancel-button')).toBeVisible();

    await still(harness, 'progress-cancel', { statusBar: false });

    // The percentage is only stable while the engine is inside its slow step, so
    // check it is *still* 45% after the shot. Without this a run that got ahead
    // of the engine would quietly ship a picture of a finished progress bar.
    expect(await label.textContent(), 'the shot must have caught the 45% step').toContain('45%');

    // The Cancel button is deliberately *not* clicked here. `diffText` is one
    // synchronous call that never checks `ctx.signal`, so on a pair this size the
    // abort is only noticed when the diff has already finished — waiting for that
    // would add half a minute to the capture for no picture. Cancellation itself
    // is covered by `e2e/regression/job-lifecycle.spec.ts`.
  } finally {
    await harness.close();
  }
});
