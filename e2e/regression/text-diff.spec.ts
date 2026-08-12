import { expect, test } from '@playwright/test';
import { launchApp } from '../helpers/launch';
import { pasteInput } from '../helpers/seed';

/**
 * REGRESSION — MVP-4: the text/code engine and its view.
 *
 * Inputs arrive via the clipboard so the whole path is real: detection picks the
 * text engine, the engine host runs it, and the view renders what came back.
 */
const BODY = Array.from({ length: 20 }, (_, index) => `body line ${index}`).join('\n');
const BEFORE = `header alpha\n${BODY}`;
const AFTER = `header beta\n${BODY}`;

test('text diff: pairing, word marks, folding, view modes', async () => {
  const harness = await launchApp();

  try {
    await pasteInput(harness, BEFORE, 'before');
    await pasteInput(harness, AFTER, 'after');

    // Plain prose, so detection lands on the text engine rather than JSON.
    await expect(harness.page.getByTestId('detected-bar')).toContainText('Text diff');
    await harness.page.getByTestId('compare-button').click();

    const diff = harness.page.getByTestId('text-diff');
    await expect(diff).toBeVisible({ timeout: 20_000 });

    // ---------- one edited line reads as a modification, not del + add ----------
    await expect(harness.page.getByTestId('summary-strip')).toContainText('1 change');
    await expect(harness.page.getByTestId('summary-strip')).toContainText('～1 modified');
    await expect(harness.page.getByTestId('summary-strip')).toContainText('＋0 added');

    // ---------- and only the changed word is marked ----------
    const marks = diff.locator('.dd-word');
    await expect(marks.first()).toBeVisible();
    const markTexts = await marks.allInnerTexts();
    expect(markTexts.join(' ')).toContain('alpha');
    expect(markTexts.join(' ')).toContain('beta');
    // "header" is shared, so it must not be inside a mark.
    expect(markTexts.join(' ')).not.toContain('header');

    // ---------- the long unchanged run folded ----------
    const fold = harness.page.getByTestId('fold-row');
    await expect(fold).toContainText('14 unchanged lines');
    const rowsBefore = await diff.locator('.dd-drow').count();
    await fold.click();
    await expect(harness.page.getByTestId('fold-row')).toHaveCount(0);
    expect(await diff.locator('.dd-drow').count()).toBeGreaterThan(rowsBefore);

    // ---------- side-by-side keeps both sides aligned in one row ----------
    await expect(diff).toHaveAttribute('data-mode', 'side');
    const firstRow = diff.locator('.dd-drow').first();
    await expect(firstRow.locator('.dd-dcell')).toHaveCount(2);
    await harness.screenshot('text-diff-side');

    // ---------- unified collapses to a single cell per row ----------
    await harness.page.getByRole('tab', { name: 'Unified' }).click();
    await expect(diff).toHaveAttribute('data-mode', 'unified');
    await expect(diff.locator('.dd-drow').first().locator('.dd-dcell')).toHaveCount(1);

    // ---------- inline shows before ⇢ after on one line ----------
    await harness.page.getByRole('tab', { name: 'Inline' }).click();
    await expect(diff).toContainText('⇢');
    await harness.screenshot('text-diff-inline');

    await harness.page.getByRole('tab', { name: 'Side-by-side' }).click();

    // ---------- change navigation reaches the one change ----------
    await expect(harness.page.getByTestId('change-position')).toHaveText('– / 1');
    await harness.page.keyboard.press('Alt+ArrowDown');
    await expect(harness.page.getByTestId('change-position')).toHaveText('1 / 1');

    // ---------- copy changed lines takes the after side, marks stripped ----------
    await harness.page.getByTestId('copy-changed-lines').click();
    const copied = await harness.app.evaluate(({ clipboard }) => clipboard.readText());
    expect(copied).toBe('header beta');

    expect(harness.errors, `errors:\n${harness.errors.join('\n')}`).toEqual([]);
  } finally {
    await harness.close();
  }
});
