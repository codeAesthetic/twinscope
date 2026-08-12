import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, test } from '@playwright/test';
import { launchApp } from '../helpers/launch';
import { openPalette } from '../helpers/seed';

/**
 * REGRESSION — MVP-10: the keyboard map and the command palette.
 *
 * The property worth protecting is that one registry drives everything: the keys
 * that fire, the grid in Settings, and the palette's action list. This spec
 * checks all three against each other rather than against a hard-coded list.
 */
test('palette and shortcuts: one registry drives keys, settings and commands', async () => {
  const harness = await launchApp();
  const files = await mkdtemp(join(tmpdir(), 'devdiff-palette-'));

  try {
    // ---------- ⌘K opens it, Esc closes it ----------
    await openPalette(harness);
    const palette = harness.page.getByTestId('command-palette');
    await expect(harness.page.getByTestId('palette-input')).toBeFocused();

    await harness.page.keyboard.press('Escape');
    await expect(palette).toHaveCount(0);

    // ---------- the actions it offers are the registry's ----------
    await openPalette(harness);
    for (const id of ['open-files', 'open-folders', 'paste-compare', 'theme', 'settings']) {
      await expect(harness.page.getByTestId(`palette-${id}`)).toBeVisible();
    }
    await expect(harness.page.getByTestId('palette-export')).toContainText('⌘⇧E');

    await harness.screenshot('palette-dark');

    // ---------- fuzzy filtering, and a count that reflects it ----------
    const input = harness.page.getByTestId('palette-input');
    await input.fill('thm');
    await expect(harness.page.getByTestId('palette-theme')).toBeVisible();
    await expect(harness.page.getByTestId('palette-open-files')).toHaveCount(0);

    await input.fill('zzzz');
    await expect(harness.page.getByTestId('palette-empty')).toBeVisible();
    await expect(harness.page.getByTestId('palette-count')).toContainText('0 of');
    await input.fill('');

    // ---------- ↑↓ move the selection, ⏎ runs it ----------
    await expect(harness.page.getByTestId('palette-open-files')).toHaveAttribute(
      'data-current',
      'true',
    );
    await harness.page.keyboard.press('ArrowDown');
    await expect(harness.page.getByTestId('palette-open-folders')).toHaveAttribute(
      'data-current',
      'true',
    );
    await harness.page.keyboard.press('ArrowUp');
    await expect(harness.page.getByTestId('palette-open-files')).toHaveAttribute(
      'data-current',
      'true',
    );

    // "Settings" is the safest action to actually execute here: it navigates
    // rather than opening a native dialog.
    await input.fill('settings');
    await harness.page.keyboard.press('Enter');
    await expect(harness.page.getByTestId('screen-settings')).toBeVisible();
    await expect(palette).toHaveCount(0);

    // ---------- the Settings grid is generated from the same table ----------
    const grid = harness.page.getByTestId('shortcuts-grid');
    await expect(grid.locator('.dd-scrow')).toHaveCount(15);
    await expect(grid).toContainText('Command palette');
    await expect(grid).toContainText('⌘⇧E');

    // ---------- the bound keys really fire ----------
    await harness.page.keyboard.press('Meta+1');
    await expect(harness.page.getByTestId('screen-compare')).toBeVisible();
    await harness.page.keyboard.press('Meta+2');
    await expect(harness.page.getByTestId('screen-history')).toBeVisible();

    await expect(harness.page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await harness.page.keyboard.press('Meta+Shift+L');
    await expect(harness.page.locator('html')).toHaveAttribute('data-theme', 'light');
    await harness.page.keyboard.press('Meta+Shift+L');

    await harness.page.keyboard.press('Meta+Comma');
    await expect(harness.page.getByTestId('screen-settings')).toBeVisible();

    // ---------- recent comparisons are in the palette, and reopen from it ----------
    // Files rather than clipboard text: only a comparison with paths on disk can
    // actually be reopened later.
    await harness.page.keyboard.press('Meta+1');
    const before = join(files, 'before.txt');
    const after = join(files, 'after.txt');
    await writeFile(before, 'alpha\nshared\n');
    await writeFile(after, 'beta\nshared\n');

    await harness.app.evaluate(
      ({ dialog }, paths: string[]) => {
        let call = 0;
        dialog.showOpenDialog = () =>
          Promise.resolve({ canceled: false, filePaths: [paths[call++] ?? paths[0]!] });
      },
      [before, after],
    );

    await harness.page.getByTestId('pick-file-before').click();
    await harness.page.getByTestId('pick-file-after').click();
    await harness.page.getByTestId('compare-button').click();
    await expect(harness.page.getByTestId('text-diff')).toBeVisible({ timeout: 20_000 });
    await harness.page.getByTestId('back-button').click();

    await openPalette(harness);
    await expect(harness.page.getByTestId('command-palette')).toContainText('Recent');
    await expect(harness.page.getByTestId('command-palette')).toContainText(
      'before.txt ↔ after.txt',
    );

    await harness.page.getByTestId('palette-input').fill('before.txt');
    await expect(harness.page.getByTestId('palette-count')).toContainText('1 of');
    await harness.page.keyboard.press('Enter');
    await expect(harness.page.getByTestId('text-diff')).toBeVisible({ timeout: 20_000 });

    expect(harness.errors, `errors:\n${harness.errors.join('\n')}`).toEqual([]);
  } finally {
    await harness.close();
    await rm(files, { recursive: true, force: true });
  }
});
