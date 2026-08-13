import { expect, test } from '@playwright/test';
import { copyFixture, freshWorkDir } from './helpers/fixtures';
import { openPair, stage, still } from './helpers/stage';

/**
 * MEDIA-1 still for the API engine (v0.3.1).
 *
 * Both files are `.json`, so the first thing the shot proves is detection by
 * *shape*: these reach the API engine rather than getting a structural tree, which
 * answers "what keys changed" instead of "who breaks". The verdict is the top line,
 * and every finding under it names the rule that produced it — a verdict nobody can
 * audit is a guess with a badge on it.
 */
test('stills: api contract verdict, with every finding naming its rule', async () => {
  const harness = await stage();
  const dir = freshWorkDir('api');

  try {
    await openPair(harness, {
      before: copyFixture('api/openapi.before.json', dir),
      after: copyFixture('api/openapi.after.json', dir),
    });
    await expect(harness.page.getByTestId('detected-bar')).toContainText('API diff');
    await harness.page.getByTestId('compare-button').click();

    await expect(harness.page.getByTestId('api-view')).toBeVisible();

    const verdict = harness.page.getByTestId('api-verdict');
    await expect(verdict).toHaveAttribute('data-breaking', 'true');
    // The count is the headline, so it has to be the right one.
    await expect(verdict).toContainText('3 breaking changes');

    const view = harness.page.getByTestId('api-view');
    // DELETE /orders/{id} is gone, `note` is gone, and `total` went number → string.
    await expect(view).toContainText('operation-removed');
    await expect(view).toContainText('response-field-removed');
    await expect(view).toContainText('type-changed');
    // …and the two compatible changes are in frame too, not hidden behind a filter:
    // a new field and a new operation break nobody, and the shot says so.
    await expect(view).toContainText('response-field-added');
    await expect(view).toContainText('operation-added');
    await expect(view.locator('[data-testid^="api-finding-"]')).toHaveCount(5);
    // Breaking first: the top row is one, which is what makes the crop readable.
    await expect(harness.page.getByTestId('api-finding-0')).toHaveAttribute(
      'data-verdict',
      'breaking',
    );

    await still(harness, 'api-contract', { statusBar: false });

    expect(harness.errors, `errors:\n${harness.errors.join('\n')}`).toEqual([]);
  } finally {
    await harness.close();
  }
});
