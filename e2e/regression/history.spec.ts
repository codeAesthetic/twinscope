import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, test } from '@playwright/test';
import { launchApp } from '../helpers/launch';

/**
 * REGRESSION — MVP-8: history, persistence and privacy.
 *
 * The privacy assertion is the important one: the database is opened directly
 * and inspected, so "history never stores file contents" is checked against the
 * bytes on disk rather than against the code that wrote them.
 */
test('history: records, reopens, stars, deletes — and never stores contents', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'devdiff-history-'));
  const files = await mkdtemp(join(tmpdir(), 'devdiff-history-files-'));
  const harness = await launchApp({ userDataDir });

  const SECRET = 'super-secret-token-9f3a2b';

  try {
    const before = join(files, 'config.json');
    const after = join(files, 'config.next.json');
    await writeFile(before, JSON.stringify({ token: SECRET, retries: 1 }, null, 2));
    await writeFile(after, JSON.stringify({ token: SECRET, retries: 5 }, null, 2));

    await harness.app.evaluate(
      ({ dialog }, paths: string[]) => {
        let call = 0;
        dialog.showOpenDialog = () =>
          Promise.resolve({ canceled: false, filePaths: [paths[call++] ?? paths[0]!] });
      },
      [before, after],
    );

    // ---------- an empty history says so ----------
    await expect(harness.page.getByTestId('recent-empty')).toBeVisible();

    await harness.page.getByTestId('pick-file-before').click();
    await harness.page.getByTestId('pick-file-after').click();
    await harness.page.getByTestId('compare-button').click();
    await expect(harness.page.getByTestId('json-tree')).toBeVisible({ timeout: 20_000 });

    // ---------- the comparison is recorded, and Home shows it ----------
    await harness.page.getByTestId('back-button').click();
    const recent = harness.page.getByTestId('recent-list');
    await expect(recent).toContainText('config.json ↔ config.next.json');
    await expect(recent).toContainText('～1');

    // ---------- the row never contains file contents (Rule 2) ----------
    // Read straight from the file the app wrote, so this checks the bytes on
    // disk rather than the code that produced them.
    const db = new DatabaseSync(join(userDataDir, 'devdiff.db'), { readOnly: true });
    const stored = JSON.stringify(db.prepare('SELECT * FROM comparisons').all());
    db.close();
    expect(stored).not.toContain(SECRET);
    expect(stored).toContain('config.next.json');

    // ---------- the History screen lists it, and search filters it ----------
    await harness.page.getByRole('button', { name: /^History/ }).click();
    const history = harness.page.getByTestId('screen-history');
    await expect(history).toContainText('Today');
    await expect(history).toContainText('config.json ↔ config.next.json');

    await harness.page.getByTestId('history-search').fill('nothing-like-this');
    await expect(harness.page.getByTestId('history-empty')).toBeVisible();
    await harness.page.getByTestId('history-search').fill('');

    // ---------- starring persists and the filter respects it ----------
    const rowId = await harness.page
      .locator('[data-testid^="star-"]')
      .first()
      .getAttribute('data-testid');
    const id = (rowId ?? 'star-1').replace('star-', '');

    await harness.page.getByRole('button', { name: 'Starred only' }).click();
    await expect(harness.page.getByTestId('history-empty')).toBeVisible();
    await harness.page.getByRole('button', { name: 'Starred only' }).click();

    await harness.page.getByTestId(`star-${id}`).click();
    await expect(harness.page.getByTestId(`star-${id}`)).toHaveAttribute('aria-pressed', 'true');
    await harness.page.getByRole('button', { name: 'Starred only' }).click();
    await expect(harness.page.getByTestId(`history-${id}`)).toBeVisible();
    await harness.page.getByRole('button', { name: 'Starred only' }).click();

    // ---------- reopening re-reads from disk and re-runs ----------
    await harness.page.getByTestId(`history-${id}`).click();
    await expect(harness.page.getByTestId('json-tree')).toBeVisible({ timeout: 20_000 });
    await expect(harness.page.getByTestId('summary-strip')).toContainText('～1 modified');

    expect(harness.errors, `errors:\n${harness.errors.join('\n')}`).toEqual([]);
  } finally {
    await harness.close();
    await rm(files, { recursive: true, force: true });
    await rm(userDataDir, { recursive: true, force: true });
  }
});

test('history: survives a restart, and a missing input is explained', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'devdiff-history2-'));
  const files = await mkdtemp(join(tmpdir(), 'devdiff-history2-files-'));

  try {
    const before = join(files, 'a.json');
    const after = join(files, 'b.json');
    await writeFile(before, '{ "a": 1 }');
    await writeFile(after, '{ "a": 2 }');

    // ---------- first run: compare, then quit ----------
    const first = await launchApp({ userDataDir });
    await first.app.evaluate(
      ({ dialog }, paths: string[]) => {
        let call = 0;
        dialog.showOpenDialog = () =>
          Promise.resolve({ canceled: false, filePaths: [paths[call++] ?? paths[0]!] });
      },
      [before, after],
    );

    await first.page.getByTestId('pick-file-before').click();
    await first.page.getByTestId('pick-file-after').click();
    await first.page.getByTestId('compare-button').click();
    await expect(first.page.getByTestId('json-tree')).toBeVisible({ timeout: 20_000 });

    // The theme is a preference, so it has to outlive the process too.
    await first.page.getByRole('button', { name: /Switch to light theme/ }).click();
    await first.close();

    // ---------- second run: the history and the preference are still there ----------
    await rm(after, { force: true });
    const second = await launchApp({ userDataDir });

    try {
      await expect(second.page.getByTestId('recent-list')).toContainText('a.json ↔ b.json');
      await expect(second.page.locator('html')).toHaveAttribute('data-theme', 'light');

      // ---------- reopening a comparison whose input is gone explains itself ----------
      await second.page.locator('[data-testid^="recent-"]').first().click();
      const notice = second.page.getByTestId('compare-notice');
      await expect(notice).toBeVisible();
      await expect(notice).toContainText('b.json');
      await expect(notice).toContainText('could not be opened');
      // The side that still exists is loaded, so recovery is one file away.
      await expect(second.page.getByTestId('drop-before')).toContainText('a.json');

      expect(second.errors, `errors:\n${second.errors.join('\n')}`).toEqual([]);
    } finally {
      await second.close();
    }
  } finally {
    await rm(files, { recursive: true, force: true });
    await rm(userDataDir, { recursive: true, force: true });
  }
});
