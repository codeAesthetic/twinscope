import { expect, test } from '@playwright/test';
import { launchApp } from '../helpers/launch';
import { openPalette } from '../helpers/seed';

/**
 * REGRESSION — MVP-2: input intake and detection.
 *
 * Driven through the clipboard, because it is the one intake route the harness
 * can exercise honestly end to end: main writes the real system clipboard, the
 * renderer asks for it over IPC, and detection runs on what actually arrived.
 * (A native file drop cannot be synthesised into Electron from Playwright.)
 */
test('intake: clipboard paste, detection, override and run', async () => {
  const harness = await launchApp();

  const setClipboard = (text: string): Promise<void> =>
    harness.app.evaluate(({ clipboard }, value: string) => clipboard.writeText(value), text);

  try {
    // ---------- ⌘⇧V fills the first empty side, then the second ----------
    await setClipboard('{"user": {"status": "pending"}}');
    await harness.page.keyboard.press('Meta+Shift+V');

    const before = harness.page.getByTestId('drop-before');
    await expect(before).toHaveAttribute('data-state', 'filled');
    // Detection ran on content, not on a filename: no extension was involved.
    await expect(before).toContainText('json');
    await expect(harness.page.getByTestId('detected-bar')).toContainText('Waiting for the AFTER');

    await setClipboard('{"user": {"status": "active"}}');
    await harness.page.keyboard.press('Meta+Shift+V');
    await expect(harness.page.getByTestId('drop-after')).toHaveAttribute('data-state', 'filled');

    // ---------- detection picks the specialised engine ----------
    const detected = harness.page.getByTestId('detected-bar');
    await expect(detected).toContainText('Detected: json');
    await expect(detected).toContainText('Structural JSON diff');
    await expect(harness.page.getByTestId('compare-button')).toBeEnabled();
    await harness.screenshot('intake-detected');

    // ---------- ⌘⇧S swaps the two sides ----------
    const nameOf = (side: 'before' | 'after'): Promise<string> =>
      harness.page.getByTestId(`drop-${side}`).locator('.dd-filecard-name').innerText();
    const originalBefore = await nameOf('before');
    await harness.page.keyboard.press('Meta+Shift+S');
    expect(await nameOf('after')).toBe(originalBefore);

    // ---------- a mismatched pair explains its fallback (Rule 3) ----------
    await harness.page.getByTestId('clear-after').click();
    await setClipboard('just some prose, definitely not json');
    await harness.page.keyboard.press('Meta+Shift+V');
    await expect(detected).toContainText('Different kinds — comparing as text');
    await expect(detected).toContainText('Text diff');

    // ---------- manual override beats detection, and says so ----------
    await harness.page.getByTestId('engine-select').selectOption('json');
    await expect(detected).toContainText('manual override');
    await expect(detected).toContainText('Structural JSON diff');
    await harness.page.getByTestId('engine-select').selectOption('');
    await expect(detected).not.toContainText('manual override');

    // ---------- ⏎ runs, and routing reaches the real engine ----------
    await harness.page.keyboard.press('Enter');
    await expect(harness.page.getByTestId('screen-workspace')).toBeVisible();
    // The mismatched pair fell back to the text engine, which now produces a
    // real diff — this assertion used to expect "not implemented yet".
    await expect(harness.page.getByTestId('text-diff')).toBeVisible({ timeout: 10_000 });

    // ---------- clearing a side retracts the ready state ----------
    await harness.page.getByTestId('back-button').click();
    await expect(harness.page.getByTestId('drop-before')).toHaveAttribute('data-state', 'empty');
    await expect(harness.page.getByTestId('detected-bar')).toContainText('Drop, browse or paste');

    expect(harness.errors, `errors:\n${harness.errors.join('\n')}`).toEqual([]);
  } finally {
    await harness.close();
  }
});

/**
 * REGRESSION — plain ⌘V (the mockup specified `⌘⇧V / ⌘V`; only the first was
 * wired until now).
 *
 * The interesting half is the *guard*: ⌘V must still paste into a focused text
 * field rather than quietly replacing a comparison input.
 */
test('intake: plain ⌘V fills a side, but never steals a field paste', async () => {
  const harness = await launchApp();

  const setClipboard = (text: string): Promise<void> =>
    harness.app.evaluate(({ clipboard }, value: string) => clipboard.writeText(value), text);

  try {
    // ---------- nothing focused: ⌘V is an intake gesture ----------
    await setClipboard('alpha line\nshared line');
    const before = harness.page.getByTestId('drop-before');
    await expect(async () => {
      await harness.page.keyboard.press('Meta+v');
      await expect(before).toHaveAttribute('data-state', 'filled', { timeout: 1000 });
    }).toPass({ timeout: 15_000 });
    await expect(before).toContainText('clipboard-a.txt');

    // ---------- and it fills the second side next, like ⌘⇧V ----------
    await setClipboard('beta line\nshared line');
    await harness.page.keyboard.press('Meta+v');
    await expect(harness.page.getByTestId('drop-after')).toHaveAttribute('data-state', 'filled');

    // ---------- typing in a field: the field gets the paste ----------
    await setClipboard('typed-into-the-field');
    await openPalette(harness);
    const palette = harness.page.getByTestId('palette-input');
    await palette.click();
    await harness.page.keyboard.press('Meta+v');
    await expect(palette).toHaveValue('typed-into-the-field');
    await harness.page.keyboard.press('Escape');

    // The inputs are untouched — no third paste landed in a drop zone.
    await expect(before).toContainText('clipboard-a.txt');

    expect(harness.errors, `errors:\n${harness.errors.join('\n')}`).toEqual([]);
  } finally {
    await harness.close();
  }
});
