import { expect, test } from '@playwright/test';
import { copyFixture, freshWorkDir } from './helpers/fixtures';
import { openPair, stage, still } from './helpers/stage';

/**
 * MEDIA-1 still for the XML engine (v0.2.4).
 *
 * Attributes are the point: they are compared as `@name` rows rather than folded
 * into the element, so a changed `@version` and a newly added `@clearance` are two
 * ordinary rows. The second thing the shot must show is a third `<tag>` arriving —
 * the most common XML edit there is, and the one a parser without `isArray` reports
 * as a type change instead of an addition.
 *
 * Shot in **Tree** rather than the default side-by-side: an XML path is long
 * (`$.catalog[0].product[0]["@clearance"]`) and side-by-side prints it into a narrow
 * column, so every row ellipses down to `$.catalog[0].pro…` and the attribute names
 * this asset exists to show are exactly what disappears.
 */
test('stills: xml attribute rows and a repeated child added', async () => {
  const harness = await stage();
  const dir = freshWorkDir('xml');

  try {
    await openPair(harness, {
      before: copyFixture('xml/config.before.xml', dir),
      after: copyFixture('xml/config.after.xml', dir),
    });
    await expect(harness.page.getByTestId('detected-bar')).toContainText('Structural XML diff');
    await harness.page.getByTestId('compare-button').click();

    const tree = harness.page.getByTestId('json-tree');
    await expect(tree).toBeVisible();
    await harness.page.getByRole('tab', { name: 'Tree' }).click();
    await expect(tree).toHaveAttribute('data-mode', 'tree');

    // Attributes are their own rows, changed ones included.
    await expect(tree).toContainText('@version');
    await expect(tree).toContainText('@updated');
    await expect(tree).toContainText('@warehouse');
    // The added attribute is an addition, not a rewritten element.
    // Bracketed in the path, because `@clearance` is not an identifier.
    const clearance = tree.locator('[data-path*="@clearance"]');
    await expect(clearance).toHaveCount(1);
    await expect(clearance).toHaveAttribute('data-state', 'add');
    // The third <tag> is one addition, not a type change: `isArray` is what keeps a
    // single `<tag>` an array of one, so the second and third arrivals are additions
    // rather than an element changing shape underneath the reader.
    const addedTag = tree.locator('[data-path*=".tag[2]"]');
    await expect(addedTag).toHaveCount(1);
    await expect(addedTag).toHaveAttribute('data-state', 'add');
    await expect(harness.page.getByTestId('summary-strip')).not.toContainText('type change');

    await still(harness, 'xml-attributes', { statusBar: false });

    expect(harness.errors, `errors:\n${harness.errors.join('\n')}`).toEqual([]);
  } finally {
    await harness.close();
  }
});
