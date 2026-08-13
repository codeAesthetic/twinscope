import { expect, test } from '@playwright/test';
import { copyFixture, copyFixtureTree, freshWorkDir } from './helpers/fixtures';
import { openFolderPair, openPair, stage, still } from './helpers/stage';

/**
 * MEDIA-1 still for projects and saved comparisons (v0.2.9).
 *
 * Three comparisons are run and saved with ⌘S into a project, then photographed in
 * History's Saved tab — the rows come from the database, through the real save path,
 * because a saved comparison has no fixture and should not gain one for a screenshot.
 *
 * Two things make the shot stable. The rows print the **paths** of their inputs, so
 * the inputs have to come from the fixed work directory (a `mkdtemp` path would put a
 * random id and the user's name into the asset), and a saved row carries no timestamp,
 * so nothing here can drift between runs.
 *
 * Three different engines on purpose: the point of the list is that a project groups
 * whatever you saved under it, not one kind of comparison. A CSV pair was the obvious
 * third and is deliberately *not* used — `badgeForKind` maps `csv` onto the `md` badge,
 * so the row would be published carrying a badge reading "MD" for a `.csv` file.
 */

const PROJECT = 'API service';

test('stills: saved comparisons grouped under the project they were saved in', async () => {
  const harness = await stage();
  const dir = freshWorkDir('projects');

  try {
    // ---------- a project, made active because that is what creating one means ----------
    await harness.page.getByTestId('nav-projects').click();
    await expect(harness.page.getByTestId('screen-projects')).toBeVisible();
    await harness.page.getByTestId('project-name').fill(PROJECT);
    await harness.page.getByTestId('project-create').click();

    const project = harness.page.locator('[data-testid^="project-"][data-active="true"]');
    await expect(project).toContainText(PROJECT);
    const projectId = (await project.getAttribute('data-testid'))?.replace('project-', '') ?? '';
    expect(projectId, 'the project just created should be the active one').not.toBe('');

    // ---------- run a comparison and save it with ⌘S, three times ----------
    const runAndSave = async (open: () => Promise<void>, view: string): Promise<void> => {
      // Creating the project left us on its screen, and each later pass starts from
      // wherever the previous one ended.
      await harness.page.getByTestId('nav-compare').click();
      await expect(harness.page.getByTestId('drop-before')).toBeVisible();

      await open();
      await harness.page.getByTestId('compare-button').click();
      await expect(harness.page.getByTestId(view)).toBeVisible();

      await harness.page.keyboard.press('Meta+s');
      await expect(harness.page.getByTestId('saved-toast')).toBeVisible();

      // "New comparison" clears both inputs, so the next pair starts from empty —
      // and it unmounts the toast, which must not hang over the shot.
      await harness.page.getByTestId('back-button').click();
      await expect(harness.page.getByTestId('saved-toast')).toHaveCount(0);
    };

    await runAndSave(
      () =>
        openPair(harness, {
          before: copyFixture('text/client.ts', dir),
          after: copyFixture('text/client.next.ts', dir),
        }),
      'text-diff',
    );
    await runAndSave(
      () =>
        openPair(harness, {
          before: copyFixture('json/users.v1.json', dir),
          after: copyFixture('json/users.v2.json', dir),
        }),
      'json-tree',
    );
    await runAndSave(
      () =>
        openFolderPair(harness, {
          before: copyFixtureTree('folder/api-v1', dir),
          after: copyFixtureTree('folder/api-v2', dir),
        }),
      'folder-tree',
    );

    // ---------- all three are in the Saved tab, under this project's heading ----------
    await harness.page.getByTestId('nav-history').click();
    await expect(harness.page.getByTestId('screen-history')).toBeVisible();
    await harness.page.getByRole('tab', { name: /^Saved/ }).click();

    const group = harness.page.getByTestId(`saved-group-project-${projectId}`);
    await expect(group).toBeVisible();
    await expect(group.locator('.dd-hitem')).toHaveCount(3);
    await expect(harness.page.getByRole('heading', { name: PROJECT })).toBeVisible();

    // Named by their inputs, and each one says which engine will run again when it
    // is opened — a saved comparison is a definition, not a stored answer.
    await expect(group).toContainText('client.ts ↔ client.next.ts');
    await expect(group).toContainText('users.v1.json ↔ users.v2.json');
    await expect(group).toContainText('api-v1/ ↔ api-v2/');
    // The engine chip specifically, not the row: `json` appears in the file names
    // too, so a row-level text match would pass without the chip being there.
    const chipsOf = (name: string) =>
      group.locator('.dd-hitem').filter({ hasText: name }).locator('.dd-hitem-chips');
    await expect(chipsOf('client.ts ↔')).toContainText('text');
    await expect(chipsOf('users.v1.json ↔')).toContainText('json');
    await expect(chipsOf('api-v1/ ↔')).toContainText('folder');

    // The paths on screen are the fixed work directory's — see the header note.
    await expect(group).toContainText('/tmp/twinscope-media/projects/client.ts');

    await still(harness, 'projects-saved', { statusBar: false });

    expect(harness.errors, `errors:\n${harness.errors.join('\n')}`).toEqual([]);
  } finally {
    await harness.close();
  }
});
