import { open, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { freshWorkDir } from './helpers/fixtures';
import { openPair, stage, still } from './helpers/stage';

/**
 * MEDIA-1 still for large-file mode (v0.2.8).
 *
 * The pair is **generated**, not committed: `LARGE_BYTES` in
 * `src/engines/large/index.ts` is 8 MB, so a fixture that reaches this engine at all
 * is far too big for git. A pinned generator is every bit as deterministic as a
 * committed file — same code, same bytes, every run — which is the argument
 * `helpers/png.ts` already makes for the image fixtures.
 *
 * Three properties make this the picture the docs need, and each of them is a way
 * the fixture could have quietly tested something else instead:
 *
 *  - **Distinct lines.** Anchoring keeps only block hashes occurring exactly once on
 *    each side, so a run of identical lines anchors nothing and the file would
 *    collapse into one enormous window — the no-anchor path, photographed by
 *    accident. Every line here carries its own request id.
 *  - **A line's text depends only on its request id**, never on where it sits. Derive
 *    it from the line number instead and the insertion renumbers every later line,
 *    so every later block hash changes and every anchor after it is gone.
 *  - **Equal line counts, with the add and the remove inside one 64-line block.** An
 *    insertion shifts every later block by a line, which has the same effect. Keeping
 *    both edits in block 2 191 means the blocks after them still match byte for byte.
 */

/** Verified against `src/engines/large/index.ts`; a smaller pair is a different engine's. */
const LARGE_BYTES = 8 * 1024 * 1024;

/**
 * 260 000 lines of about 42 bytes: ~10.9 MB a side, comfortably over the threshold.
 *
 * The line is deliberately **short**. A side of the diff pane fits roughly 55
 * monospaced characters at this window size, and a row wider than that is truncated
 * with an ellipsis — which in a documentation still hides the very words the picture
 * exists to show. That is why the timestamp has no date and no logger name: the
 * changed text has to survive to the right-hand edge.
 */
const LINES = 260_000;

/** Requests, 1-based — which is also the BEFORE side's line numbering. */
const FAILED_REQUEST = 140_000;
const REMOVED_REQUEST = 140_242;
/** In the same 64-line block as the removal, so the line count is unchanged. */
const RETRY_AFTER_REQUEST = 140_245;
const SLOW_REQUEST = 140_480;

const pad = (value: number, width: number): string => String(value).padStart(width, '0');

function stamp(request: number): string {
  return `04:${pad(Math.floor(request / 60) % 60, 2)}:${pad(request % 60, 2)}.${pad(request % 1000, 3)}`;
}

function line(level: string, request: number, body: string): string {
  return `${stamp(request)} ${level} ${body}`;
}

function ordinary(request: number): string {
  return line('INFO ', request, `req ${100_000 + request} ok in ${12 + (request % 88)}ms`);
}

/**
 * The log as one side sees it: exactly `LINES` lines, whichever side it is.
 *
 * Four edits in ten megabytes — one request that now fails, one dropped, one retry
 * line inserted three requests later, and one that got slow enough to warn about.
 */
function* logLines(after: boolean): Generator<string> {
  let emitted = 0;
  let request = 0;

  while (emitted < LINES) {
    request += 1;

    if (after && request === REMOVED_REQUEST) continue;

    if (after && request === FAILED_REQUEST) {
      yield line('ERROR', request, `req ${100_000 + request} failed after 3 tries`);
    } else if (after && request === SLOW_REQUEST) {
      yield line('WARN ', request, `req ${100_000 + request} ok in 4812ms`);
    } else {
      yield ordinary(request);
    }
    emitted += 1;

    if (after && request === RETRY_AFTER_REQUEST && emitted < LINES) {
      yield line('INFO ', REMOVED_REQUEST, `retry queued for req ${100_000 + REMOVED_REQUEST}`);
      emitted += 1;
    }
  }
}

async function writeLog(path: string, after: boolean): Promise<void> {
  const handle = await open(path, 'w');
  try {
    let chunk: string[] = [];
    for (const text of logLines(after)) {
      chunk.push(text);
      if (chunk.length === 5_000) {
        await handle.write(`${chunk.join('\n')}\n`);
        chunk = [];
      }
    }
    if (chunk.length > 0) await handle.write(`${chunk.join('\n')}\n`);
  } finally {
    await handle.close();
  }
}

test('stills: large-file mode — windows between folds it never read', async () => {
  const harness = await stage();
  expect(harness.target).toBe('app');
  const dir = freshWorkDir('large');

  try {
    const before = join(dir, 'orders-2026-08-10.log');
    const after = join(dir, 'orders-2026-08-11.log');
    await writeLog(before, false);
    await writeLog(after, true);

    // A pair under the threshold is line-diffed by the ordinary engine, and this
    // still would then be a picture of a different feature.
    for (const path of [before, after]) {
      expect((await stat(path)).size).toBeGreaterThan(LARGE_BYTES);
    }

    await openPair(harness, { before, after });
    await expect(harness.page.getByTestId('detected-bar')).toContainText('Large text diff');

    // No heavy-input confirmation here, on purpose: this engine indexes rather than
    // reads, so warning about these sizes would warn about the thing it fixed.
    await harness.page.getByTestId('compare-button').click();

    const diff = harness.page.getByTestId('text-diff');
    await expect(diff).toBeVisible({ timeout: 120_000 });

    // Four edits across 260 000 lines a side.
    const strip = harness.page.getByTestId('summary-strip');
    await expect(strip).toContainText('～2 modified');
    await expect(strip).toContainText('＋1 added');
    await expect(strip).toContainText('－1 removed');
    await expect(strip).toContainText('windows');

    // The view opens at the top, where two fold rows stand for the hundred and forty
    // thousand unchanged lines the comparison never read.
    const lazyFolds = diff.locator('[data-testid="fold-row"][data-lazy="true"]');
    await expect(lazyFolds.first()).toBeVisible();
    await expect(lazyFolds.first()).toContainText('unchanged lines — click to expand');

    // …and the changed regions are on the same screen, at their real line numbers.
    await expect(diff).toContainText('failed after 3 tries');
    await expect(diff.locator('.dd-dln', { hasText: '140000' }).first()).toBeVisible();
    await expect(diff.locator('.dd-word').first()).toBeVisible();

    // The caps are claims about what the mode did *not* do, and they are in frame.
    const notes = harness.page.getByTestId('normalize-notes');
    await expect(notes).toContainText('blocks of 64 lines');
    await expect(notes).toContainText('byte-exact');

    await still(harness, 'large-text-windows', { statusBar: false });

    // Not in the picture, but proved in the same run: a fold carries a byte range,
    // and opening one fetches its lines from disk through `input:range`.
    const folded = (await lazyFolds.first().textContent()) ?? '';
    await lazyFolds.first().click();
    await expect(diff.locator('.dd-dcell[data-kind="ctx"]').first()).toContainText('req 100001', {
      timeout: 30_000,
    });
    await expect(diff.getByText(folded, { exact: true })).toHaveCount(0);

    expect(harness.errors, `errors:\n${harness.errors.join('\n')}`).toEqual([]);
  } finally {
    await harness.close();
  }
});
