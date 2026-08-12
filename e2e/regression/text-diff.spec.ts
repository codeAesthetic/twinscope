import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
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

/**
 * REGRESSION — search within a diff (⌘F), deferred from MVP-4 and landed after
 * 0.1.0.
 *
 * The property that matters is that a search hit and an engine word-mark can be
 * the *same run of text* and both survive — that is why matching and marking are
 * resolved in one pass rather than layered.
 */
const SEARCH_BEFORE = [
  'const timeout = 5000;',
  'shared line one',
  'let retries = 2;',
  'shared line two',
  'const timeoutMs = 100;',
].join('\n');

const SEARCH_AFTER = [
  'const timeout = 8000;',
  'shared line one',
  'let retries = 3;',
  'shared line two',
  'const timeoutMs = 100;',
].join('\n');

test('text diff: ⌘F finds, counts, cycles and highlights', async () => {
  const harness = await launchApp();

  try {
    await pasteInput(harness, SEARCH_BEFORE, 'before');
    await pasteInput(harness, SEARCH_AFTER, 'after');
    await harness.page.getByTestId('compare-button').click();

    const diff = harness.page.getByTestId('text-diff');
    await expect(diff).toBeVisible({ timeout: 20_000 });

    // ---------- the box is live for a text diff, and ⌘F focuses it ----------
    const search = harness.page.getByTestId('workspace-search');
    await expect(search).toBeEnabled();
    await harness.page.keyboard.press('Meta+f');
    await expect(search).toBeFocused();

    // ---------- matches are counted across both sides of a modified row ----------
    // "timeout" appears on the left and right of the modified line, plus once
    // on the unchanged `timeoutMs` line.
    await search.fill('timeout');
    const count = harness.page.getByTestId('search-count');
    await expect(count).toHaveText('– / 3');
    await expect(diff.locator('[data-hit="true"]')).not.toHaveCount(0);

    // ---------- ⏎ walks them, ⇧⏎ walks back, and it wraps ----------
    await search.press('Enter');
    await expect(count).toHaveText('1 / 3');
    await expect(diff.locator('[data-hit-current="true"]')).toHaveCount(1);

    await search.press('Enter');
    await expect(count).toHaveText('2 / 3');
    await search.press('Shift+Enter');
    await expect(count).toHaveText('1 / 3');
    await search.press('Shift+Enter');
    await expect(count).toHaveText('3 / 3'); // wrapped backwards

    // ---------- a hit inside a changed word keeps *both* highlights ----------
    // On the modified line the engine marked "5000"/"8000"; searching for the
    // changed number must show a run that is both a word mark and a hit.
    await search.fill('8000');
    await expect(count).toHaveText('– / 1');
    const both = diff.locator('.dd-word[data-hit="true"]');
    await expect(both).toHaveCount(1);
    await expect(both).toHaveText('8000');

    await harness.screenshot('text-diff-search');

    // ---------- search is a find, not a filter: no rows disappear ----------
    const rowsWhileSearching = await diff.locator('.dd-drow').count();
    await search.fill('');
    await expect(count).toHaveCount(0);
    expect(await diff.locator('.dd-drow').count()).toBe(rowsWhileSearching);

    // ---------- a query that matches nothing says so by showing no badge ----------
    await search.fill('definitely-not-present');
    await expect(count).toHaveCount(0);

    // ---------- Esc clears the query and returns focus to the diff ----------
    await search.press('Escape');
    await expect(search).toHaveValue('');
    await expect(search).not.toBeFocused();

    expect(harness.errors, `errors:\n${harness.errors.join('\n')}`).toEqual([]);
  } finally {
    await harness.close();
  }
});

/**
 * REGRESSION — syntax highlighting and the normalisation toggles, the last two
 * items of MVP-4.
 *
 * Driven through the file picker so the inputs carry a `.ts` extension: the
 * language comes from detection, and a clipboard paste has none.
 */
test('text diff: highlighting, and toggles that re-run the engine', async () => {
  const harness = await launchApp();
  const dir = await mkdtemp(join(tmpdir(), 'twinscope-hl-'));

  try {
    const before = join(dir, 'client.ts');
    const after = join(dir, 'client.next.ts');
    await writeFile(before, 'const timeout = 5000;\nexport function request() {}\n');
    await writeFile(after, 'const timeout = 8000;\nexport function REQUEST() {}\n');

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

    const diff = harness.page.getByTestId('text-diff');
    await expect(diff).toBeVisible({ timeout: 20_000 });

    // ---------- grammars load lazily, so colour arrives a tick later ----------
    const coloured = diff.locator('.dd-dtext span[style*="color"]');
    await expect(coloured.first()).toBeVisible({ timeout: 20_000 });

    // Different token kinds get different colours — one uniform colour would
    // mean the theme loaded but the grammar did not.
    const palette = await diff.evaluate((root) => {
      const spans = [...root.querySelectorAll('.dd-dtext span[style*="color"]')];
      return [...new Set(spans.map((span) => (span as HTMLElement).style.color))].length;
    });
    expect(palette).toBeGreaterThan(1);

    await harness.screenshot('text-diff-highlighted');

    // ---------- highlighting must not displace the change marks ----------
    await expect(diff.locator('.dd-word').first()).toBeVisible();

    // ---------- ignore case: a toggle that re-runs the engine ----------
    const strip = harness.page.getByTestId('summary-strip');
    await expect(strip).toContainText('～2 modified');

    await harness.page.getByRole('button', { name: 'Ignore case' }).click();
    // REQUEST vs request is no longer a difference, so one modification goes.
    await expect(strip).toContainText('～1 modified', { timeout: 20_000 });

    await harness.page.getByRole('button', { name: 'Ignore case' }).click();
    await expect(strip).toContainText('～2 modified', { timeout: 20_000 });

    expect(harness.errors, `errors:\n${harness.errors.join('\n')}`).toEqual([]);
  } finally {
    await harness.close();
    await rm(dir, { recursive: true, force: true });
  }
});
