import { mkdtemp, open, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, test } from '@playwright/test';
import { launchApp, type Harness } from '../helpers/launch';

/**
 * REGRESSION — v0.2.8: large-file mode.
 *
 * The engine is unit-tested against a fake ranged reader; what this spec proves is
 * the part no unit test can reach:
 *
 *  - a pair over the size threshold is **detected** as `text-large`, not line-diffed
 *    by the ordinary engine, which would refuse it;
 *  - the change is found at its real line number in a file the app never held;
 *  - an unchanged span is a fold that carries no rows, and **opening it fetches
 *    them** through `input:range` — the one path that crosses main, the schema and
 *    the view;
 *  - the notes that explain what the mode did not do are on screen (Rule 3).
 *
 * 12 MB a side: over `LARGE_BYTES` (8 MB) so detection routes here, over the 10 MB
 * inline limit so the text really does stay on disk, and small enough that
 * generating it costs about a second.
 */

/** Roughly 12 MB of log-shaped lines, optionally altering one line deep inside. */
async function writeLog(path: string, alter: boolean): Promise<void> {
  const handle = await open(path, 'w');
  try {
    let line = 0;
    let written = 0;
    while (written < 12 * 1024 * 1024) {
      const chunk: string[] = [];
      for (let at = 0; at < 5000; at += 1) {
        line += 1;
        const body =
          alter && line === 40_000
            ? `worker[2] request ${line} FAILED after 3 retries`
            : `worker[${line % 8}] request ${line} completed in ${line % 97}ms`;
        chunk.push(`2026-08-13T00:00:00.000Z INFO ${body}`);
      }
      const text = `${chunk.join('\n')}\n`;
      written += Buffer.byteLength(text);
      await handle.write(text);
    }
  } finally {
    await handle.close();
  }
}

async function stage(harness: Harness): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'twinscope-large-'));
  const before = join(root, 'service-before.log');
  const after = join(root, 'service-after.log');
  await writeLog(before, false);
  await writeLog(after, true);

  await harness.app.evaluate(
    ({ dialog }, queued: string[]) => {
      let call = 0;
      dialog.showOpenDialog = () =>
        Promise.resolve({ canceled: false, filePaths: [queued[call++] ?? queued[0]!] });
    },
    [before, after],
  );

  return root;
}

test('large-file mode: windowed diff, real line numbers, folds that load on demand', async () => {
  const harness = await launchApp();
  let root: string | null = null;

  try {
    root = await stage(harness);

    await harness.page.getByTestId('pick-file-before').click();
    await harness.page.getByTestId('pick-file-after').click();

    // ---------- detection routes a big pair to this engine, not to `text` ----------
    await expect(harness.page.getByTestId('detected-bar')).toContainText('Large text diff');

    await harness.page.getByTestId('compare-button').click();
    const diff = harness.page.getByTestId('text-diff');
    await expect(diff).toBeVisible({ timeout: 60_000 });

    // ---------- one changed line, and one change to navigate ----------
    const strip = harness.page.getByTestId('summary-strip');
    await expect(strip).toContainText('～1 modified');
    await expect(harness.page.getByTestId('change-position')).toHaveText('– / 1');

    // ---------- the unchanged spans are folds with no rows behind them ----------
    // Asserted before navigating anywhere: the list is virtualised, so a fold is
    // only in the DOM while it is on screen, and the view opens at the top where
    // the file's first fold is.
    const lazyFolds = diff.locator('[data-testid="fold-row"][data-lazy="true"]');
    await expect(lazyFolds.first()).toBeVisible();
    const foldText = (await lazyFolds.first().textContent()) ?? '';
    expect(foldText).toMatch(/unchanged lines — click to expand/);

    await harness.screenshot('large-file-folded');

    // ---------- opening one fetches its lines through input:range ----------
    await lazyFolds.first().click();
    // The first fold starts at line 1, so line 1 of the file is now on screen —
    // fetched from disk, since the result never carried it.
    await expect(diff.locator('.dd-dcell[data-kind="ctx"]').first()).toContainText('request 1 ', {
      timeout: 20_000,
    });
    // It really was a fetch and a replacement: that fold is gone.
    await expect(diff.getByText(foldText, { exact: true })).toHaveCount(0);

    await harness.screenshot('large-file-expanded');

    // ---------- the change is at the line number it really has ----------
    await harness.page.getByRole('button', { name: 'Next change' }).click();
    const current = diff.locator('.dd-drow[data-current="true"]');
    await expect(current).toContainText('FAILED after 3 retries');
    await expect(current.locator('.dd-dln').first()).toHaveText('40000');

    // ---------- what the mode did not do is on screen (Rule 3) ----------
    const notes = harness.page.getByTestId('normalize-notes');
    await expect(notes).toContainText('blocks of 64 lines');
    await expect(notes).toContainText('byte-exact');

    expect(harness.errors, `errors:\n${harness.errors.join('\n')}`).toEqual([]);
  } finally {
    if (root !== null) await rm(root, { recursive: true, force: true });
    await harness.close();
  }
});

test('the ordinary text engine can still be forced, and still warns first', async () => {
  const harness = await launchApp();
  let root: string | null = null;

  try {
    root = await stage(harness);

    await harness.page.getByTestId('pick-file-before').click();
    await harness.page.getByTestId('pick-file-after').click();

    // Overriding to `text` on the same pair: the heavy-input confirmation from
    // MVP-11 belongs to *that* engine at this size, and large-file mode skipping it
    // must not have deleted it. This is the assertion `hardening.spec.ts` gave up
    // when its 12 MB pair started routing here.
    await harness.page.getByTestId('engine-select').selectOption('text');
    await harness.page.getByTestId('compare-button').click();
    await expect(harness.page.getByTestId('confirm-heavy')).toBeVisible();
    await harness.page.getByTestId('confirm-heavy').click();

    const diff = harness.page.getByTestId('text-diff');
    await expect(diff).toBeVisible({ timeout: 60_000 });
    // The ordinary engine materialises its folds, so none of them is lazy.
    await expect(diff.locator('[data-testid="fold-row"][data-lazy="true"]')).toHaveCount(0);
    await expect(harness.page.getByTestId('summary-strip')).toContainText('～1 modified');

    expect(harness.errors, `errors:\n${harness.errors.join('\n')}`).toEqual([]);
  } finally {
    if (root !== null) await rm(root, { recursive: true, force: true });
    await harness.close();
  }
});

test('large-file mode: identical files answer from the index alone', async () => {
  const harness = await launchApp();
  let root: string | null = null;

  try {
    root = await mkdtemp(join(tmpdir(), 'twinscope-large-same-'));
    const before = join(root, 'same-before.log');
    const after = join(root, 'same-after.log');
    await writeLog(before, false);
    await writeLog(after, false);

    await harness.app.evaluate(
      ({ dialog }, queued: string[]) => {
        let call = 0;
        dialog.showOpenDialog = () =>
          Promise.resolve({ canceled: false, filePaths: [queued[call++] ?? queued[0]!] });
      },
      [before, after],
    );

    await harness.page.getByTestId('pick-file-before').click();
    await harness.page.getByTestId('pick-file-after').click();
    await harness.page.getByTestId('compare-button').click();

    // No rows at all, and a note saying why — never an empty pane (§0.3).
    await expect(harness.page.getByTestId('normalize-notes')).toContainText('identical', {
      timeout: 60_000,
    });
    await expect(harness.page.getByTestId('summary-strip')).toContainText('～0 modified');

    expect(harness.errors, `errors:\n${harness.errors.join('\n')}`).toEqual([]);
  } finally {
    if (root !== null) await rm(root, { recursive: true, force: true });
    await harness.close();
  }
});
