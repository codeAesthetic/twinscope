import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { pasteInput } from '../helpers/seed';
import { beat, newClip } from './helpers/clip';
import { copyFixture, copyFixtureTree, freshWorkDir, imagePair } from './helpers/fixtures';
import { openFolderPair, openPair, stage, stubPicker } from './helpers/stage';

/**
 * MEDIA-1 — the six recorded walkthroughs.
 *
 * Every test has the same shape: set the app up, `clip.begin()`, do the thing
 * with a deliberate beat between steps, `clip.end()`, close, save. The waits are
 * *pacing*, not synchronisation: a GIF that changes three things in 200ms shows
 * nothing, so each step is given long enough to read.
 *
 * Titles all start with `gifs:` so `npm run capture -- --stills` can exclude
 * them: these take ten times as long as a still to produce.
 *
 * Nothing here re-tests behaviour the regression suite already owns; the
 * assertions exist only to make sure the recording is of the state it claims.
 */

const FIXTURES = join(__dirname, 'fixtures');
const readFixture = (rel: string): string => readFileSync(join(FIXTURES, `${rel}.txt`), 'utf8');

test('gifs: R1 — two JSON files land, then array-order normalisation moves', async () => {
  const clip = newClip('R1-json-normalisation');
  const harness = await stage({ recording: true, recordVideo: clip.recordVideo });
  const dir = freshWorkDir('gif-json');

  try {
    clip.ready();
    // The inputs *arriving* is part of this clip, so only the picker is stubbed
    // here — the two clicks that fill the zones happen on camera.
    await stubPicker(harness, [
      copyFixture('json/users.v1.json', dir),
      copyFixture('json/users.v2.json', dir),
    ]);

    await clip.begin(harness);

    await harness.page.getByTestId('pick-file-before').click();
    await expect(harness.page.getByTestId('drop-before')).toHaveAttribute('data-state', 'filled');
    await beat(harness.page, 500);

    await harness.page.getByTestId('pick-file-after').click();
    await expect(harness.page.getByTestId('detected-bar')).toContainText('Structural JSON diff');
    await beat(harness.page, 700);

    await harness.page.getByTestId('compare-button').click();
    await expect(harness.page.getByTestId('json-tree')).toBeVisible();
    await beat(harness.page, 900);

    // Identity matching hides the reordered `roles` array; index matching does
    // not — the counts and the Explain notes both move.
    const toggle = harness.page.getByTestId('opt-ignoreArrayOrder').getByRole('switch');
    await toggle.click();
    await expect(harness.page.getByTestId('summary-strip')).toContainText('～11 modified');
    await beat(harness.page, 1100);

    await toggle.click();
    await expect(harness.page.getByTestId('summary-strip')).toContainText('～8 modified');

    await clip.end(harness);
  } finally {
    await harness.close();
  }
  await clip.save(harness.page);
});

test('gifs: R2 — side-by-side, unified, inline, and a fold opening', async () => {
  const clip = newClip('R2-text-view-modes');
  const harness = await stage({ recording: true, recordVideo: clip.recordVideo });
  const dir = freshWorkDir('gif-text');

  try {
    clip.ready();
    await openPair(harness, {
      before: copyFixture('text/client.ts', dir),
      after: copyFixture('text/client.next.ts', dir),
    });
    await harness.page.getByTestId('compare-button').click();

    const diff = harness.page.getByTestId('text-diff');
    await expect(diff).toBeVisible();
    await expect(diff.locator('.dd-dtext span[style*="color"]').first()).toBeVisible();
    await expect(diff.locator('.dd-word').first()).toBeVisible();

    await clip.begin(harness);

    // The three modes, from the toolbar. NOT via ⌘\ — the registry advertises
    // that binding and the Settings grid prints it, but nothing implements it:
    // `useActions` falls through to a `twinscope:action` CustomEvent that no
    // component listens for. Recording a key that does nothing would ship a GIF
    // of a bug, so this drives the control the user can actually rely on.
    await harness.page.getByRole('tab', { name: 'Unified' }).click();
    await expect(diff).toHaveAttribute('data-mode', 'unified');
    await beat(harness.page, 1300);

    await harness.page.getByRole('tab', { name: 'Inline' }).click();
    await expect(diff).toHaveAttribute('data-mode', 'inline');
    await beat(harness.page, 1300);

    await harness.page.getByRole('tab', { name: 'Side-by-side' }).click();
    await expect(diff).toHaveAttribute('data-mode', 'side');
    await beat(harness.page, 700);

    // …and the folded run of unchanged lines opens where it is.
    await harness.page.getByTestId('fold-row').click();
    await expect(harness.page.getByTestId('fold-row')).toHaveCount(0);

    await clip.end(harness);
  } finally {
    await harness.close();
  }
  await clip.save(harness.page);
});

test('gifs: R3 — ⌘F, a count, and ⏎ walking the hits', async () => {
  const clip = newClip('R3-search-in-diff');
  const harness = await stage({ recording: true, recordVideo: clip.recordVideo });
  const dir = freshWorkDir('gif-search');

  try {
    clip.ready();
    await openPair(harness, {
      before: copyFixture('text/client.ts', dir),
      after: copyFixture('text/client.next.ts', dir),
    });
    await harness.page.getByTestId('compare-button').click();

    const diff = harness.page.getByTestId('text-diff');
    await expect(diff).toBeVisible();
    await expect(diff.locator('.dd-dtext span[style*="color"]').first()).toBeVisible();

    await clip.begin(harness);

    await harness.page.keyboard.press('Meta+f');
    const search = harness.page.getByTestId('workspace-search');
    await expect(search).toBeFocused();
    await beat(harness.page, 400);

    // Typed rather than filled, so the count appears as the query narrows.
    // Pacing is tight on purpose: every reveal scrolls the whole diff, and a
    // full-frame change is what a GIF pays for — at 6s this clip could not hold
    // 12fps inside 2 MB.
    await search.pressSequentially('timeout', { delay: 85 });
    const count = harness.page.getByTestId('search-count');
    await expect(count).toBeVisible();
    await beat(harness.page, 550);

    // `timeoutMs` → `timeoutBudgetMs` is a changed *word*, so one of these hits
    // is inside an engine mark — both highlights have to survive.
    await expect(diff.locator('.dd-word[data-hit="true"]')).not.toHaveCount(0);

    for (const _step of [1, 2, 3]) {
      await search.press('Enter');
      await beat(harness.page, 520);
    }
    await search.press('Shift+Enter');

    await clip.end(harness);
  } finally {
    await harness.close();
  }
  await clip.save(harness.page);
});

test('gifs: R4 — filter to modified, drill into a file, breadcrumb back', async () => {
  const clip = newClip('R4-folder-drill-in');
  const harness = await stage({ recording: true, recordVideo: clip.recordVideo });
  const dir = freshWorkDir('gif-folder');

  try {
    clip.ready();
    await openFolderPair(harness, {
      before: copyFixtureTree('folder/api-v1', dir),
      after: copyFixtureTree('folder/api-v2', dir),
    });
    await harness.page.getByTestId('compare-button').click();

    const tree = harness.page.getByTestId('folder-tree');
    await expect(tree).toBeVisible();

    await clip.begin(harness);

    await harness.page.getByRole('tab', { name: 'Modified' }).click();
    await expect(tree.locator('[data-path="README.md"]')).toHaveCount(0);
    await beat(harness.page, 1000);

    await tree.locator('[data-path="src/client.ts"]').dblclick();
    await expect(harness.page.getByTestId('text-diff')).toBeVisible();
    await beat(harness.page, 1400);

    // Back to the tree with its result intact — the 10-file scan is not redone,
    // and on a 10k-file tree that is the difference between instant and not.
    await harness.page.getByTestId('breadcrumb-back').click();
    await expect(harness.page.getByTestId('folder-tree')).toBeVisible();

    await clip.end(harness);
  } finally {
    await harness.close();
  }
  await clip.save(harness.page);
});

test('gifs: R5 — the four image modes, then a stricter threshold', async () => {
  const clip = newClip('R5-image-modes');
  const harness = await stage({ recording: true, recordVideo: clip.recordVideo });
  const dir = freshWorkDir('gif-image');

  try {
    clip.ready();
    await openPair(harness, imagePair(dir));
    await harness.page.getByTestId('compare-button').click();

    const stageEl = harness.page.getByTestId('image-stage');
    await expect(stageEl).toBeVisible();
    await expect(stageEl.locator('.dd-region')).toHaveCount(3);

    await clip.begin(harness);

    await harness.page.getByRole('tab', { name: 'Overlay' }).click();
    await expect(harness.page.getByTestId('pane-overlay')).toBeVisible();
    await beat(harness.page, 900);

    // Long enough to catch two flips of the 1.1s alternation.
    await harness.page.getByRole('tab', { name: 'Blink' }).click();
    await expect(harness.page.getByTestId('pane-blink')).toBeVisible();
    await beat(harness.page, 2400);

    await harness.page.getByRole('tab', { name: 'Difference' }).click();
    await expect(harness.page.getByTestId('pane-diff')).toBeVisible();
    await beat(harness.page, 1000);

    // The slider is 1–50 in whole percent, and the fixture's smallest change is
    // a ~31% channel distance — so it takes a real drag, not a nudge, to make a
    // region drop out. Each step re-runs the comparison: the percentage, the
    // region list and the boxes on the stage all follow the thumb.
    await harness.page.getByRole('tab', { name: 'Side-by-side' }).click();
    const threshold = harness.page.getByTestId('threshold');
    await threshold.press('ArrowRight', { delay: 60 });
    for (let step = 0; step < 24; step += 1) {
      await threshold.press('ArrowRight');
      await harness.page.waitForTimeout(55);
    }
    await expect(harness.page.getByTestId('diff-pct')).not.toHaveText('1.40%');

    await clip.end(harness);
  } finally {
    await harness.close();
  }
  await clip.save(harness.page);
});

test('gifs: R6 — paste both sides, swap, run', async () => {
  const clip = newClip('R6-intake-paste');
  const harness = await stage({ recording: true, recordVideo: clip.recordVideo });

  try {
    clip.ready();
    // Warm the clipboard listener: the first key after boot can land before the
    // renderer has attached its handler, and a lost paste inside a recording is
    // a silent hole in the middle of the GIF.
    await pasteInput(harness, 'warm-up', 'before');
    await harness.page.getByTestId('clear-before').click();

    await clip.begin(harness);

    await pasteInput(harness, readFixture('json/users.v1.json'), 'before');
    await expect(harness.page.getByTestId('drop-before')).toContainText('json');
    await beat(harness.page, 800);

    // Plain ⌘V for the second side — the platform's own paste, not a binding.
    await harness.app.evaluate(
      ({ clipboard }, text: string) => clipboard.writeText(text),
      readFixture('json/users.v2.json'),
    );
    await harness.page.keyboard.press('Meta+v');
    await expect(harness.page.getByTestId('drop-after')).toHaveAttribute('data-state', 'filled');
    await expect(harness.page.getByTestId('detected-bar')).toContainText('Structural JSON diff');
    await beat(harness.page, 1100);

    // ⌘⇧S swaps the sides, in case they went in the wrong way round.
    await harness.page.keyboard.press('Meta+Shift+S');
    await beat(harness.page, 900);
    await harness.page.keyboard.press('Meta+Shift+S');
    await beat(harness.page, 600);

    // ⏎ runs it.
    await harness.page.keyboard.press('Enter');
    await expect(harness.page.getByTestId('json-tree')).toBeVisible();

    await clip.end(harness);
  } finally {
    await harness.close();
  }
  await clip.save(harness.page);
});
