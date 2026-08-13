import { expect } from '@playwright/test';
import type { Harness } from './launch';

/**
 * Waits until the renderer is mounted and listening, before the first keypress.
 *
 * `bridge-status` only shows a version once `ping()` has round-tripped, which
 * happens in an effect after mount — by which point the keymap's own effect has
 * attached its listener. Without this, the *first* press of a run can land in the
 * gap between paint and listener and be silently lost: a spec that passes alone
 * and fails when another ran first, which is the worst way for a test to fail.
 *
 * `pasteInput` keeps its retry as well. This removes the usual cause; the retry
 * covers the rest.
 */
export async function waitForReady(harness: Harness): Promise<void> {
  await expect(harness.page.getByTestId('bridge-status')).toContainText('electron', {
    timeout: 20_000,
  });
}

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
  await waitForReady(harness);
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

/**
 * Opens the command palette with the real shortcut.
 *
 * Retried for the same reason `pasteInput` is: immediately after boot the
 * renderer may not have attached its keydown listener yet, and the first press
 * is then silently lost.
 */
export async function openPalette(harness: Harness): Promise<void> {
  await waitForReady(harness);
  const palette = harness.page.getByTestId('command-palette');
  await expect(async () => {
    await harness.page.keyboard.press('Meta+k');
    await expect(palette).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 15_000 });
}
