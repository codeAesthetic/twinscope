import { expect, test } from '@playwright/test';
import { copyFixture, copyFixtureTree, freshWorkDir, imagePair } from './helpers/fixtures';
import { openFolderPair, openPair, stage, still } from './helpers/stage';

/**
 * MEDIA-1: the History screen, with one row per engine.
 *
 * The rows are produced the way a user produces them — four real comparisons
 * through intake, the engine host and the database — because history has no
 * fixture path and should not gain one for a screenshot. Every row reads "just
 * now", which is what keeps this capture stable: no wall-clock text can drift.
 */
test('stills: history with a row per engine', async () => {
  const harness = await stage();
  const dir = freshWorkDir('history');

  try {
    const run = async (open: () => Promise<void>, done: string): Promise<void> => {
      await open();
      await harness.page.getByTestId('compare-button').click();
      await expect(harness.page.getByTestId(done)).toBeVisible();
      await harness.page.getByTestId('back-button').click();
    };

    await run(() => openPair(harness, imagePair(dir)), 'image-stage');
    await run(
      () =>
        openFolderPair(harness, {
          before: copyFixtureTree('folder/api-v1', dir),
          after: copyFixtureTree('folder/api-v2', dir),
        }),
      'folder-tree',
    );
    await run(
      () =>
        openPair(harness, {
          before: copyFixture('text/client.ts', dir),
          after: copyFixture('text/client.next.ts', dir),
        }),
      'text-diff',
    );
    await run(
      () =>
        openPair(harness, {
          before: copyFixture('json/users.v1.json', dir),
          after: copyFixture('json/users.v2.json', dir),
        }),
      'json-tree',
    );

    await harness.page.keyboard.press('Meta+2');
    const history = harness.page.getByTestId('screen-history');
    await expect(history).toBeVisible();
    await expect(history.locator('.dd-hitem')).toHaveCount(4);
    await expect(history).toContainText('Today');

    await still(harness, 'history-list');

    expect(harness.errors, `errors:\n${harness.errors.join('\n')}`).toEqual([]);
  } finally {
    await harness.close();
  }
});
