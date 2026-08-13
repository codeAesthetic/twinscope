import { expect, test } from '@playwright/test';
import { copyFixture, freshWorkDir } from './helpers/fixtures';
import { openPair, stage, still } from './helpers/stage';

/**
 * MEDIA-1 still for the CSV engine (v0.2.5).
 *
 * The grid is only worth a screenshot once rows are paired on a key: paired by
 * position, a moved row reads as a wall of changed cells and the picture says
 * nothing. Pairing on `order_id` re-runs the engine (pairing is a property of the
 * comparison, not of the presentation), after which every difference in frame is a
 * real one — cell-level changes on four orders, one row gone, one arrived, and the
 * row that merely moved reported as identical.
 */
test('stills: csv grid with cell-level changes, paired on a key column', async () => {
  const harness = await stage();
  const dir = freshWorkDir('csv');

  try {
    await openPair(harness, {
      before: copyFixture('csv/orders.before.csv', dir),
      after: copyFixture('csv/orders.after.csv', dir),
    });
    await expect(harness.page.getByTestId('detected-bar')).toContainText('Table diff');
    await harness.page.getByTestId('compare-button').click();

    const table = harness.page.getByTestId('csv-table');
    await expect(table).toBeVisible();

    // Re-runs the engine, so wait for the chip that says the new pairing landed.
    await harness.page.getByTestId('csv-key-column').selectOption('order_id');
    await expect(harness.page.getByTestId('csv-key-chip')).toContainText('paired on order_id');

    const strip = harness.page.getByTestId('summary-strip');
    // 1007 arrived, 1005 went, four orders changed, and 1004 — the moved row — is
    // identical, which is the whole argument for pairing on a key.
    await expect(strip).toContainText('＋1 added');
    await expect(strip).toContainText('－1 removed');
    await expect(strip).toContainText('～4 modified');

    // Cell-level, not row-level: order 1002 kept four cells and changed three.
    //
    // Deliberately 1002 rather than 1001: seven columns and the normalisation rail
    // do not both fit in 1440px, so `status` and `updated` sit past the right edge.
    // 1002's changed cells are `items` and `total_gbp`, which are in frame — and
    // `toBeInViewport` is the assertion that keeps that true if the layout moves.
    const edited = table.locator('[data-key="1002"]');
    await expect(edited).toHaveAttribute('data-status', 'mod');
    const changed = edited.locator('[data-state="chg"]');
    await expect(changed).toHaveCount(3);
    await expect(changed.nth(0).locator('.dd-csvwas')).toHaveText('1');
    await expect(changed.nth(0).locator('.dd-csvnow')).toHaveText('2');
    await expect(changed.nth(0)).toBeInViewport();
    await expect(changed.nth(1).locator('.dd-csvwas')).toHaveText('19.99');
    await expect(changed.nth(1)).toBeInViewport();

    // The row that arrived and the row that went, both in frame.
    await expect(table.locator('[data-key="1007"]')).toHaveAttribute('data-status', 'add');
    await expect(table.locator('[data-key="1005"]')).toHaveAttribute('data-status', 'del');
    // …and 1004, which only moved, is identical — the argument for a key column.
    await expect(table.locator('[data-key="1004"]')).toHaveAttribute('data-status', 'same');

    await still(harness, 'csv-grid', { statusBar: false });

    expect(harness.errors, `errors:\n${harness.errors.join('\n')}`).toEqual([]);
  } finally {
    await harness.close();
  }
});
