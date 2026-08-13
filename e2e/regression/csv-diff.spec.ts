import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, test } from '@playwright/test';
import { launchApp, type Harness } from '../helpers/launch';

/**
 * REGRESSION — v0.2.5: the CSV engine and the table view.
 *
 * The first new *view* of the series, so this spec has two jobs: prove the engine's
 * two pairing modes, and prove the grid renders them — sticky header, row-number
 * gutter, and a changed cell that shows both values.
 */

/** Same three records both sides, one edited, one removed, one added, reordered. */
const BEFORE = `id,name,city,updated
1,Ada,London,2026-01-01
2,Bob,Leeds,2026-01-02
3,Cy,Hull,2026-01-03
`;

const AFTER = `id,name,city,updated
3,Cy,Hull,2026-08-13
1,Ada,Cambridge,2026-08-13
4,Dee,York,2026-08-13
`;

async function stage(harness: Harness, files: Array<[string, string]>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'twinscope-csv-'));
  const paths: string[] = [];
  for (const [name, content] of files) {
    const path = join(root, name);
    await writeFile(path, content);
    paths.push(path);
  }

  await harness.app.evaluate(({ dialog }, queued: string[]) => {
    let call = 0;
    dialog.showOpenDialog = () =>
      Promise.resolve({ canceled: false, filePaths: [queued[call++] ?? queued[0]!] });
  }, paths);

  return root;
}

test('csv diff: the grid, cell-level changes, and pairing on a key column', async () => {
  const harness = await launchApp();
  let root: string | null = null;

  try {
    root = await stage(harness, [
      ['people-before.csv', BEFORE],
      ['people-after.csv', AFTER],
    ]);

    await harness.page.getByTestId('pick-file-before').click();
    await harness.page.getByTestId('pick-file-after').click();
    await expect(harness.page.getByTestId('detected-bar')).toContainText('Table diff');

    await harness.page.getByTestId('compare-button').click();

    const table = harness.page.getByTestId('csv-table');
    await expect(table).toBeVisible({ timeout: 20_000 });

    // ---------- the header is a union, with the column names as its cells ----------
    for (const column of ['id', 'name', 'city', 'updated']) {
      await expect(table.locator(`[data-column="${column}"]`)).toHaveCount(1);
    }
    await expect(table).toContainText('4 columns');

    // ---------- paired by position to begin with ----------
    await expect(table).toContainText('paired by position');

    await harness.screenshot('csv-table-position');

    // ---------- pairing on `id` re-runs the engine and ignores row order ----------
    await harness.page.getByTestId('csv-key-column').selectOption('id');
    await expect(harness.page.getByTestId('csv-key-chip')).toContainText('paired on id', {
      timeout: 20_000,
    });

    const strip = harness.page.getByTestId('summary-strip');
    // id 4 added, id 2 removed, id 1 and id 3 changed (city / updated).
    await expect(strip).toContainText('＋1 added');
    await expect(strip).toContainText('－1 removed');
    await expect(strip).toContainText('～2 modified');

    // ---------- a changed cell shows both values, on one line ----------
    const edited = table.locator('[data-key="1"]');
    await expect(edited).toHaveAttribute('data-status', 'mod');
    // Two cells changed on this row — city and updated — and each keeps its old
    // value beside the new one, on the same line, so the row height stays fixed.
    const changedCells = edited.locator('[data-state="chg"]');
    await expect(changedCells).toHaveCount(2);
    await expect(changedCells.first().locator('.dd-csvwas')).toHaveText('London');
    await expect(changedCells.first().locator('.dd-csvnow')).toHaveText('Cambridge');
    // The name cell did not change, so it carries no old value at all.
    await expect(edited.locator('[data-state="same"]')).toHaveCount(2);

    // ---------- the gutter says which record it was on each side ----------
    await expect(table.locator('[data-key="4"]')).toContainText('–');

    await harness.screenshot('csv-table-keyed');

    // ---------- filters and change navigation ----------
    await harness.page.getByRole('tab', { name: 'Added' }).click();
    await expect(table.locator('[data-key="4"]')).toHaveCount(1);
    await expect(table.locator('[data-key="1"]')).toHaveCount(0);
    await harness.page.getByRole('tab', { name: 'All' }).click();

    // ⌘F searches the values, including the ones that were replaced.
    await harness.page.getByTestId('workspace-search').fill('London');
    await expect(table.locator('[data-key="1"]')).toHaveCount(1);
    await expect(table.locator('[data-key="4"]')).toHaveCount(0);
    await harness.page.getByTestId('workspace-search').fill('');

    await expect(harness.page.getByTestId('change-position')).toHaveText('– / 4');

    expect(harness.errors, `errors:\n${harness.errors.join('\n')}`).toEqual([]);
  } finally {
    await harness.close();
    if (root !== null) await rm(root, { recursive: true, force: true });
  }
});

test('csv diff: an inserted row is one addition, not a shifted file', async () => {
  const harness = await launchApp();
  let root: string | null = null;

  try {
    root = await stage(harness, [
      ['a.csv', 'id,name,city\n1,Ada,London\n2,Bob,Leeds\n3,Cy,Hull\n'],
      ['b.csv', 'id,name,city\n1,Ada,London\n9,New,Bath\n2,Bob,Leeds\n3,Cy,Hull\n'],
    ]);

    await harness.page.getByTestId('pick-file-before').click();
    await harness.page.getByTestId('pick-file-after').click();
    await harness.page.getByTestId('compare-button').click();

    await expect(harness.page.getByTestId('csv-table')).toBeVisible({ timeout: 20_000 });
    const strip = harness.page.getByTestId('summary-strip');
    // Aligned first, so the three rows below the insertion are untouched. Comparing
    // index-by-index would report all three as modified.
    await expect(strip).toContainText('＋1 added');
    await expect(strip).toContainText('～0 modified');
    await expect(strip).toContainText('3 identical');

    expect(harness.errors, `errors:\n${harness.errors.join('\n')}`).toEqual([]);
  } finally {
    await harness.close();
    if (root !== null) await rm(root, { recursive: true, force: true });
  }
});

test('csv diff: a new column is marked, and a header can be turned off', async () => {
  const harness = await launchApp();
  let root: string | null = null;

  try {
    root = await stage(harness, [
      ['a.csv', 'id,name\n1,Ada\n'],
      ['b.csv', 'id,name,email\n1,Ada,ada@example.com\n'],
    ]);

    await harness.page.getByTestId('pick-file-before').click();
    await harness.page.getByTestId('pick-file-after').click();
    await harness.page.getByTestId('compare-button').click();

    const table = harness.page.getByTestId('csv-table');
    await expect(table).toBeVisible({ timeout: 20_000 });

    await expect(table.locator('[data-column="email"]')).toHaveAttribute('data-status', 'add');
    await expect(harness.page.getByTestId('summary-strip')).toContainText('1 + columns');

    // ---------- no header: the first row becomes data and columns get numbers ----------
    await harness.page.getByRole('button', { name: 'First row is a header' }).click();
    await expect(table.locator('[data-column="Column 1"]')).toHaveCount(1, { timeout: 20_000 });
    await expect(harness.page.getByTestId('summary-strip')).toContainText('2 → 2 rows');

    expect(harness.errors, `errors:\n${harness.errors.join('\n')}`).toEqual([]);
  } finally {
    await harness.close();
    if (root !== null) await rm(root, { recursive: true, force: true });
  }
});

test('csv diff: a tab-separated file is read by its extension, not by sniffing', async () => {
  const harness = await launchApp();
  let root: string | null = null;

  try {
    // Cells containing commas would sniff as comma-delimited and produce nonsense.
    root = await stage(harness, [
      ['a.tsv', 'id\tnote\n1\tone, two\n'],
      ['b.tsv', 'id\tnote\n1\tone, three\n'],
    ]);

    await harness.page.getByTestId('pick-file-before').click();
    await harness.page.getByTestId('pick-file-after').click();
    await harness.page.getByTestId('compare-button').click();

    const table = harness.page.getByTestId('csv-table');
    await expect(table).toBeVisible({ timeout: 20_000 });
    await expect(table).toContainText('2 columns');
    await expect(harness.page.getByTestId('summary-strip')).toContainText('～1 modified');

    expect(harness.errors, `errors:\n${harness.errors.join('\n')}`).toEqual([]);
  } finally {
    await harness.close();
    if (root !== null) await rm(root, { recursive: true, force: true });
  }
});
