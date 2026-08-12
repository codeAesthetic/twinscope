import { expect, test } from '@playwright/test';
import { launchApp } from '../helpers/launch';
import { pasteInput } from '../helpers/seed';

/**
 * REGRESSION — MVP-5: the JSON engine and its tree view.
 *
 * The pair is the mockup's demo payload, pasted through the clipboard so the
 * whole path is real: detection picks the JSON engine, the worker runs it, and
 * the tree renders what came back. Normalisation toggles must re-run the engine
 * rather than filter rows locally — that is the property worth protecting here.
 */
const BEFORE = JSON.stringify(
  {
    user: {
      id: 'u_10482',
      name: 'Ada L.',
      status: 'pending',
      age: 27,
      avatar: 'https://cdn.calc.dev/a/1f2.png',
      address: { city: 'London', zip: 'CB2 1TN' },
      roles: ['viewer'],
    },
    meta: { requestId: 'r_881' },
  },
  null,
  2,
);

const AFTER = JSON.stringify(
  {
    user: {
      id: 'u_10482',
      name: 'Ada Lovelace',
      status: 'active',
      age: '27',
      phone: '+1 415 555 0132',
      address: { city: 'Cambridge', zip: 'CB2 1TN' },
      roles: ['viewer', 'editor'],
    },
    meta: { requestId: 'r_902' },
  },
  null,
  2,
);

test('json diff: tree, normalisation round-trip, search, copy path', async () => {
  const harness = await launchApp();

  try {
    await pasteInput(harness, BEFORE, 'before');
    await pasteInput(harness, AFTER, 'after');

    await expect(harness.page.getByTestId('detected-bar')).toContainText('Structural JSON diff');
    await harness.page.getByTestId('compare-button').click();

    const tree = harness.page.getByTestId('json-tree');
    await expect(tree).toBeVisible({ timeout: 20_000 });

    // ---------- structural counts, not line counts ----------
    const strip = harness.page.getByTestId('summary-strip');
    await expect(strip).toContainText('＋2 added'); // phone, roles[1]
    await expect(strip).toContainText('－1 removed'); // avatar
    // name, status, city and requestId changed; age changed type.
    await expect(strip).toContainText('～5 modified');
    await expect(strip).toContainText('⚠ 1 type change');

    // ---------- a type change is its own row kind, with the transition named ----------
    const ageRow = tree.locator('[data-path="$.user.age"]');
    await expect(ageRow).toHaveAttribute('data-state', 'type');
    await expect(ageRow).toContainText('number → string');

    // ---------- containers carry a changed-descendant badge ----------
    await expect(tree.locator('[data-path="$.user.address"] .dd-jbadge')).toHaveText('1 changed');

    // ---------- "only changes" is on by default, so unchanged leaves are hidden ----------
    await expect(tree.locator('[data-path="$.user.id"]')).toHaveCount(0);
    await harness.page.getByRole('button', { name: 'Only changes' }).click();
    await expect(tree.locator('[data-path="$.user.id"]')).toHaveCount(1);
    await harness.page.getByRole('button', { name: 'Only changes' }).click();

    await harness.screenshot('json-tree-dark');

    // ---------- ignoring a path re-runs the engine: counts change, and it says so ----------
    await expect(harness.page.getByTestId('json-explain')).toContainText('Nothing was suppressed');
    await harness.page.getByTestId('add-path').click();
    await harness.page.getByTestId('path-input').fill('meta.requestId');
    await harness.page.getByTestId('path-input').press('Enter');

    await expect(strip).toContainText('～4 modified', { timeout: 20_000 });
    await expect(strip).toContainText('1 suppressed');
    await expect(harness.page.getByTestId('json-explain')).toContainText(
      '1 of 8 differences were suppressed',
    );

    // ---------- and "show them" puts them back ----------
    await harness.page.getByTestId('show-suppressed').click();
    await expect(strip).toContainText('～5 modified', { timeout: 20_000 });
    await expect(harness.page.getByTestId('ignored-paths')).not.toContainText('meta.requestId');

    // ---------- array order: identity matching hides a reorder, index matching does not ----------
    const optionRow = harness.page.getByTestId('opt-ignoreArrayOrder');
    await expect(optionRow.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
    await optionRow.getByRole('switch').click();
    await expect(optionRow.getByRole('switch')).toHaveAttribute('aria-checked', 'false', {
      timeout: 20_000,
    });
    // roles: ["viewer"] vs ["viewer","editor"] — by index that is one addition either way.
    await expect(strip).toContainText('＋2 added');
    await optionRow.getByRole('switch').click();

    // ---------- search filters rows but keeps their ancestors ----------
    const search = harness.page.getByTestId('workspace-search');
    await expect(search).toBeEnabled();
    await search.fill('Cambridge');
    await expect(tree.locator('[data-path="$.user.address.city"]')).toHaveCount(1);
    await expect(tree.locator('[data-path="$.user.address"]')).toHaveCount(1); // ancestor kept
    await expect(tree.locator('[data-path="$.user.status"]')).toHaveCount(0);
    await search.fill('');

    // ---------- copy path yields a JSONPath ----------
    await tree.locator('[data-path="$.user.address.city"]').click({ button: 'right' });
    await harness.page.getByRole('menuitem', { name: 'Copy path' }).click();
    expect(await harness.app.evaluate(({ clipboard }) => clipboard.readText())).toBe(
      '$.user.address.city',
    );

    // ---------- change navigation walks the changed leaves ----------
    await expect(harness.page.getByTestId('change-position')).toHaveText('– / 8');
    await harness.page.keyboard.press('Alt+ArrowDown');
    await expect(harness.page.getByTestId('change-position')).toHaveText('1 / 8');

    expect(harness.errors, `errors:\n${harness.errors.join('\n')}`).toEqual([]);
  } finally {
    await harness.close();
  }
});

test('json diff: unparseable input offers the text engine instead', async () => {
  const harness = await launchApp();

  try {
    await pasteInput(harness, '{ "a": 1 }', 'before');
    await pasteInput(harness, '{ "a": 1, }', 'after');

    // The trailing comma means detection sees plain text, so this is the
    // "I know these are JSON" path: pick the engine by hand.
    await harness.page.getByTestId('engine-select').selectOption('json');
    await harness.page.getByTestId('compare-button').click();

    const panel = harness.page.getByTestId('job-error');
    await expect(panel).toBeVisible({ timeout: 20_000 });
    await expect(panel).toContainText('is not valid JSON');
    await expect(panel).toContainText('line');

    // The recovery is one click, not a trip back to the Compare screen.
    await harness.page.getByTestId('error-fallback').click();
    await expect(harness.page.getByTestId('text-diff')).toBeVisible({ timeout: 20_000 });

    expect(harness.errors, `errors:\n${harness.errors.join('\n')}`).toEqual([]);
  } finally {
    await harness.close();
  }
});
