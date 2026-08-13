import { expect, test } from '@playwright/test';
import { copyFixture, freshWorkDir } from './helpers/fixtures';
import { openPair, stage, still } from './helpers/stage';

/**
 * MEDIA-1 still for the YAML engine (v0.2.3).
 *
 * The pair is a Compose file with an anchor and a `<<: *defaults` merge key, which
 * is the only interesting thing a YAML diff does that a JSON one cannot: the shot
 * has to show the *inherited* values compared under each service, not the alias.
 * A tree containing `<<` would be a picture of the bug this engine exists to avoid.
 *
 * Shot in **Tree** rather than the default side-by-side, for a reason a screenshot
 * makes obvious and an assertion cannot: side-by-side prints the whole JSONPath in a
 * narrow column, so every row reads `$.services.api.r…` and the keys the merge key
 * brought in — the subject of the asset — are the part that gets ellipsed away.
 */
test('stills: yaml anchors and merge keys, compared as inherited values', async () => {
  const harness = await stage();
  const dir = freshWorkDir('yaml');

  try {
    await openPair(harness, {
      before: copyFixture('yaml/compose.before.yml', dir),
      after: copyFixture('yaml/compose.after.yml', dir),
    });
    await expect(harness.page.getByTestId('detected-bar')).toContainText('Structural YAML diff');
    await harness.page.getByTestId('compare-button').click();

    const tree = harness.page.getByTestId('json-tree');
    await expect(tree).toBeVisible();
    await harness.page.getByRole('tab', { name: 'Tree' }).click();
    await expect(tree).toHaveAttribute('data-mode', 'tree');

    // The alias was expanded, not compared: no `<<` key survives into the tree…
    await expect(tree).not.toContainText('<<');
    // …and the values it brought in are compared under each service that merged it.
    await expect(tree.locator('[data-path="$.services.api.restart"]')).toHaveAttribute(
      'data-state',
      'chg',
    );
    await expect(tree.locator('[data-path="$.services.worker.restart"]')).toHaveAttribute(
      'data-state',
      'chg',
    );
    // The nested map it brought in is compared under each service too — the merge
    // key is applied, not merely resolved to a reference. Single-quoted selector:
    // the path itself carries the double quotes `max-size` needs.
    for (const service of ['api', 'worker']) {
      const maxSize = tree.locator(
        `[data-path='$.services.${service}.logging.options["max-size"]']`,
      );
      await expect(maxSize).toHaveCount(1);
      await expect(maxSize).toHaveAttribute('data-state', 'chg');
    }
    // The new service is the addition the strip counts.
    await expect(tree.locator('[data-path="$.services.metrics"]')).toHaveAttribute(
      'data-state',
      'add',
    );

    await still(harness, 'yaml-anchors', { statusBar: false });

    expect(harness.errors, `errors:\n${harness.errors.join('\n')}`).toEqual([]);
  } finally {
    await harness.close();
  }
});
