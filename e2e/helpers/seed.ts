import { expect } from '@playwright/test';
import type { Harness } from './launch';

/**
 * Clipboard intake, the way the harness can drive it honestly: write the real
 * system clipboard, then press the real shortcut.
 *
 * The press is retried until the zone actually fills. Immediately after boot the
 * renderer may not have attached its keydown listener yet, and a single press
 * that lands in that gap is silently lost — which showed up as one spec failing
 * only when it ran after another.
 */
export async function pasteInput(
  harness: Harness,
  text: string,
  side: 'before' | 'after',
): Promise<void> {
  await harness.app.evaluate(({ clipboard }, value: string) => clipboard.writeText(value), text);

  const zone = harness.page.getByTestId(`drop-${side}`);
  await expect(async () => {
    await harness.page.keyboard.press('Meta+Shift+V');
    await expect(zone.locator('.dd-filecard')).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 15_000 });
}

/**
 * Runs a real comparison so history has something in it.
 *
 * Since MVP-8 the recent list and the History screen are live, so any spec that
 * wants rows to look at has to produce them the way a user would — paste, run,
 * come back. Nothing here is fixture data: it goes through intake, the engine
 * host and the database.
 */
export async function seedComparison(
  harness: Harness,
  before: string,
  after: string,
): Promise<void> {
  await pasteInput(harness, before, 'before');
  await pasteInput(harness, after, 'after');
  await harness.page.getByTestId('compare-button').click();
  await expect(harness.page.getByTestId('summary-strip')).toBeVisible({ timeout: 20_000 });
  await harness.page.getByTestId('back-button').click();
}
