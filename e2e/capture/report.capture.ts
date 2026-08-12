import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, expect, test } from '@playwright/test';
import { copyFixture, freshWorkDir } from './helpers/fixtures';
import {
  DEVICE_SCALE_FACTOR,
  freezeClock,
  openPair,
  stage,
  STILLS_DIR,
  stubSave,
  VIEWPORT,
} from './helpers/stage';

/**
 * MEDIA-1: the exported HTML report.
 *
 * Exported for real out of the app, then opened in a real browser — which is
 * both the honest way to photograph it and a check that the claim "one file that
 * opens anywhere" holds. The renderer's clock is frozen first because the report
 * stamps its own generation time into the header.
 */
test('stills: the exported HTML report, opened in a browser', async () => {
  const dir = freshWorkDir('report');
  const report = join(dir, 'twinscope-report.html');
  const harness = await stage();

  try {
    await openPair(harness, {
      before: copyFixture('text/client.ts', dir),
      after: copyFixture('text/client.next.ts', dir),
    });
    await harness.page.getByTestId('compare-button').click();
    await expect(harness.page.getByTestId('text-diff')).toBeVisible();

    await freezeClock(harness);
    await stubSave(harness, report);
    await harness.page.getByTestId('export-button').click();
    await harness.page.getByTestId('export-html').click();
    await expect(harness.page.getByTestId('export-toast')).toContainText('Report saved');

    expect(harness.errors, `errors:\n${harness.errors.join('\n')}`).toEqual([]);
  } finally {
    await harness.close();
  }

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: VIEWPORT,
      deviceScaleFactor: DEVICE_SCALE_FACTOR,
      colorScheme: 'dark',
    });
    await page.goto(`file://${report}`);
    await expect(page.locator('h1')).toContainText('client.ts');

    mkdirSync(STILLS_DIR, { recursive: true });
    await page.screenshot({
      path: join(STILLS_DIR, 'html-report.png'),
      animations: 'disabled',
      caret: 'hide',
    });
    console.log('[capture] still html-report — rendered in chromium');
  } finally {
    await browser.close();
  }
});
