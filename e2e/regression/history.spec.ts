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
  const userDataDir = await mkdtemp(join(tmpdir(), 'twinscope-history-'));
  const files = await mkdtemp(join(tmpdir(), 'twinscope-history-files-'));
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
    const db = new DatabaseSync(join(userDataDir, 'twinscope.db'), { readOnly: true });
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

    // ---------- the actions overlay the row's right edge ----------
    // A button cannot nest inside a button, so the star and delete buttons are a
    // *sibling* of the row and only CSS puts them on it. With the wrap's
    // positioning context missing they render as inline content below every row
    // — laid out, styled, and in the wrong place, which no other assertion here
    // could see. The first documentation stills shipped that way.
    const row = harness.page.getByTestId(`history-${id}`);
    const wrap = harness.page.locator('.dd-hitem-wrap').filter({ has: row });
    const actions = wrap.locator('.dd-hitem-actions');

    expect(
      await wrap.evaluate((el) => ({
        wrap: getComputedStyle(el).position,
        actions: getComputedStyle(el.querySelector('.dd-hitem-actions')!).position,
      })),
    ).toEqual({ wrap: 'relative', actions: 'absolute' });

    const rowBox = (await row.boundingBox())!;
    const actionsBox = (await actions.boundingBox())!;
    // Inside the row vertically — the whole bug was "below it instead".
    expect(actionsBox.y).toBeGreaterThanOrEqual(rowBox.y);
    expect(actionsBox.y + actionsBox.height).toBeLessThanOrEqual(rowBox.y + rowBox.height);
    // At the right edge, not floating in the middle of the row.
    expect(actionsBox.x).toBeGreaterThan(rowBox.x + rowBox.width / 2);
    expect(rowBox.x + rowBox.width - (actionsBox.x + actionsBox.width)).toBeLessThan(24);

    // Revealed on hover, and — the half a keyboard user depends on — kept
    // revealed by focus alone, with the pointer parked elsewhere.
    await harness.page.mouse.move(4, 4);
    await expect(actions).toHaveCSS('opacity', '0');
    await row.hover();
    await expect(actions).toHaveCSS('opacity', '1');
    await harness.page.getByTestId(`star-${id}`).focus();
    await harness.page.mouse.move(4, 4);
    await expect(actions).toHaveCSS('opacity', '1');

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

test('history: a CSV comparison is badged CSV, not MD', async () => {
  // v0.2.5 added the CSV engine and no badge for it, so `historyView.tsx` mapped
  // csv → 'md' and every recorded CSV comparison read "MD" in the recent list, the
  // History screen and the sidebar's Saved rail. A wrong label on a saved row is worse
  // than none: it is the only thing telling you what a stored comparison *was*.
  const userDataDir = await mkdtemp(join(tmpdir(), 'twinscope-history-csv-'));
  const files = await mkdtemp(join(tmpdir(), 'twinscope-history-csv-files-'));
  const harness = await launchApp({ userDataDir });

  try {
    const before = join(files, 'orders.csv');
    const after = join(files, 'orders.next.csv');
    await writeFile(before, 'id,customer,total\n1,Priya,64.50\n2,Sam,19.99\n');
    await writeFile(after, 'id,customer,total\n1,Priya,71.00\n2,Sam,19.99\n');

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
    await expect(harness.page.getByTestId('csv-table')).toBeVisible({ timeout: 20_000 });

    await harness.page.getByTestId('back-button').click();
    const badge = harness.page.getByTestId('recent-list').locator('.dd-ftype').first();
    await expect(badge).toHaveAttribute('data-kind', 'csv');
    await expect(badge).toHaveText('CSV');

    // A hue of its own in both themes — every badge kind carries a light pair, and a
    // kind added without one inherits the default and reads as a different type.
    const colours: string[] = [];
    for (const theme of ['dark', 'light'] as const) {
      await harness.page.evaluate((next) => {
        document.documentElement.setAttribute('data-theme', next);
      }, theme);
      colours.push(await badge.evaluate((element) => getComputedStyle(element).color));
    }
    expect(colours[0]).not.toBe(colours[1]);

    expect(harness.errors, `errors:\n${harness.errors.join('\n')}`).toEqual([]);
  } finally {
    await harness.close();
    await rm(files, { recursive: true, force: true });
    await rm(userDataDir, { recursive: true, force: true });
  }
});

test('history: comparisons stamped the same second still list newest first', async () => {
  // `created_at`/`opened_at` default to `datetime('now')`, which has one-second
  // resolution, so comparisons run back to back share a stamp. `ORDER BY
  // opened_at DESC` alone leaves that tie to the query plan, and the plan
  // resolves it by *ascending* rowid — oldest on top, but only for the pairs
  // that happened to land in the same second, so the list order moved with how
  // fast the machine was. Found by a screenshot: `history-list.png` seeds four
  // comparisons in about a second and two of its rows swapped between capture
  // runs (§3.2). `RECENCY` in `main/history.ts` breaks the tie by id.
  //
  // The stamps are equalised on disk between the two launches rather than raced
  // for: a test that only sometimes produces the tie only sometimes tests it.
  const userDataDir = await mkdtemp(join(tmpdir(), 'twinscope-history-tie-'));
  const files = await mkdtemp(join(tmpdir(), 'twinscope-history-tie-files-'));

  const pairs = ['alpha', 'beta', 'gamma'].map((name) => ({
    title: `${name}.json ↔ ${name}.next.json`,
    before: join(files, `${name}.json`),
    after: join(files, `${name}.next.json`),
  }));

  try {
    for (const pair of pairs) {
      await writeFile(pair.before, '{ "n": 1 }');
      await writeFile(pair.after, '{ "n": 2 }');
    }

    // ---------- first launch: three comparisons, in this order ----------
    const first = await launchApp({ userDataDir });
    await first.app.evaluate(
      ({ dialog }, paths: string[]) => {
        let call = 0;
        dialog.showOpenDialog = () =>
          Promise.resolve({ canceled: false, filePaths: [paths[call++] ?? paths[0]!] });
      },
      pairs.flatMap((pair) => [pair.before, pair.after]),
    );

    for (const pair of pairs) {
      await first.page.getByTestId('pick-file-before').click();
      await first.page.getByTestId('pick-file-after').click();
      await first.page.getByTestId('compare-button').click();
      await expect(first.page.getByTestId('json-tree')).toBeVisible({ timeout: 20_000 });
      await first.page.getByTestId('back-button').click();
      await expect(first.page.getByTestId('recent-list')).toContainText(pair.title);
    }
    await first.close();

    // ---------- force the tie the capture only sometimes produced ----------
    const db = new DatabaseSync(join(userDataDir, 'twinscope.db'));
    db.exec(`UPDATE comparisons SET opened_at = (SELECT MAX(opened_at) FROM comparisons)`);
    const stored = db
      .prepare('SELECT id, opened_at FROM comparisons ORDER BY id ASC')
      .all() as Array<{ id: number; opened_at: string }>;
    db.close();

    // The tie is the premise: assert it exists, or the rest passes for free.
    expect(stored).toHaveLength(3);
    expect(new Set(stored.map((row) => row.opened_at)).size).toBe(1);

    // ---------- second launch: newest first, both places that list them ----------
    const second = await launchApp({ userDataDir });
    const newestFirst = [...pairs].reverse().map((pair) => pair.title);

    try {
      // Home's list and the History screen read the same query; both are checked
      // because a tiebreak added to one of them would be a silent disagreement.
      await expect(second.page.getByTestId('recent-list').locator('.dd-ritem-name')).toHaveText(
        newestFirst,
      );

      await second.page.getByRole('button', { name: /^History/ }).click();
      const history = second.page.getByTestId('screen-history');
      await expect(history.locator('.dd-hitem-name')).toHaveText(newestFirst);

      expect(second.errors, `errors:\n${second.errors.join('\n')}`).toEqual([]);
    } finally {
      await second.close();
    }
  } finally {
    await rm(files, { recursive: true, force: true });
    await rm(userDataDir, { recursive: true, force: true });
  }
});

test('history: survives a restart, and a missing input is explained', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'twinscope-history2-'));
  const files = await mkdtemp(join(tmpdir(), 'twinscope-history2-files-'));

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
