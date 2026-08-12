import { expect, test } from '@playwright/test';
import { copyFixture, freshWorkDir } from './helpers/fixtures';
import { openPair, stage, still } from './helpers/stage';

/**
 * MEDIA-1 stills for the JSON engine: the tree, the normalisation rail, the
 * Explain block with something actually suppressed, and the recovery offered
 * when a file will not parse.
 */
test('stills: json tree, normalisation rail, explain', async () => {
  const harness = await stage();
  const dir = freshWorkDir('json');

  try {
    await openPair(harness, {
      before: copyFixture('json/users.v1.json', dir),
      after: copyFixture('json/users.v2.json', dir),
    });
    await harness.page.getByTestId('compare-button').click();

    const tree = harness.page.getByTestId('json-tree');
    await expect(tree).toBeVisible();
    await expect(harness.page.getByTestId('summary-strip')).toContainText('type change');

    await still(harness, 'json-tree', { statusBar: false });
    await still(harness, 'json-normalisation-rail', {
      clip: ['json-options'],
      pad: 10,
    });

    // Explain earns its place only when normalisation actually hid something, so
    // suppress a path first and photograph the state that says so.
    await harness.page.getByTestId('add-path').click();
    await harness.page.getByTestId('path-input').fill('meta.requestId');
    await harness.page.getByTestId('path-input').press('Enter');
    await expect(harness.page.getByTestId('json-explain')).toContainText('were suppressed');

    await still(harness, 'json-explain', {
      clip: ['ignored-paths', 'json-explain'],
      pad: 12,
    });

    expect(harness.errors, `errors:\n${harness.errors.join('\n')}`).toEqual([]);
  } finally {
    await harness.close();
  }
});

test('stills: a file that will not parse offers the text engine', async () => {
  const harness = await stage();
  const dir = freshWorkDir('json-broken');

  try {
    // Both names end in `.json`, so detection picks the JSON engine and the
    // failure is the one a user actually hits: a trailing comma in a config.
    await openPair(harness, {
      before: copyFixture('json/config.json', dir),
      after: copyFixture('json/config.broken.json', dir),
    });
    await harness.page.getByTestId('compare-button').click();

    const panel = harness.page.getByTestId('job-error');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('is not valid JSON');
    await expect(harness.page.getByTestId('error-fallback')).toBeVisible();

    await still(harness, 'json-parse-error-fallback');

    expect(harness.errors, `errors:\n${harness.errors.join('\n')}`).toEqual([]);
  } finally {
    await harness.close();
  }
});
