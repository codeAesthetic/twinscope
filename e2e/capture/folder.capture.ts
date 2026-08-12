import { expect, test } from '@playwright/test';
import { copyFixtureTree, freshWorkDir } from './helpers/fixtures';
import { openFolderPair, stage, still } from './helpers/stage';

/**
 * MEDIA-1 stills for the folder engine.
 *
 * The two trees are real directories, copied out of the committed fixtures into
 * the fixed work path — the folder view prints its roots, so the path is part of
 * the picture and must not be a random temp directory.
 */
test('stills: folder tree, status filter, drill-in', async () => {
  const harness = await stage();
  const dir = freshWorkDir('folders');

  try {
    await openFolderPair(harness, {
      before: copyFixtureTree('folder/api-v1', dir),
      after: copyFixtureTree('folder/api-v2', dir),
    });
    await harness.page.getByTestId('compare-button').click();

    const tree = harness.page.getByTestId('folder-tree');
    await expect(tree).toBeVisible();
    await expect(harness.page.getByTestId('summary-strip')).toContainText('renamed');

    await still(harness, 'folder-tree', { statusBar: false });

    await harness.page.getByRole('tab', { name: 'Modified' }).click();
    await expect(tree.locator('[data-path="src/client.ts"]')).toHaveCount(1);
    await expect(tree.locator('[data-path="README.md"]')).toHaveCount(0);
    await still(harness, 'folder-filters', { statusBar: false });

    // Drill in: the file pair opens as its own text diff, one click from the
    // tree it came from.
    await harness.page.getByRole('tab', { name: 'All' }).click();
    await tree.locator('[data-path="src/client.ts"]').dblclick();
    await expect(harness.page.getByTestId('text-diff')).toBeVisible();
    await expect(harness.page.getByTestId('breadcrumb-back')).toBeVisible();
    await expect(
      harness.page.getByTestId('text-diff').locator('.dd-dtext span[style*="color"]').first(),
    ).toBeVisible();
    await still(harness, 'folder-drill-in', { statusBar: false });

    expect(harness.errors, `errors:\n${harness.errors.join('\n')}`).toEqual([]);
  } finally {
    await harness.close();
  }
});
