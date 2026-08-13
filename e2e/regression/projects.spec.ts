import { DatabaseSync } from 'node:sqlite';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, test } from '@playwright/test';
import { launchApp, type Harness } from '../helpers/launch';

/**
 * REGRESSION — v0.2.9: projects and saved comparisons.
 *
 * Five claims, all of which are about *behaviour over time* rather than about a
 * screen looking right:
 *
 *  - ⌘S saves the comparison on screen into the active project;
 *  - opening it again **re-runs** it (a definition, not a stored answer) — proved by
 *    editing a file in between and getting the new answer;
 *  - a project's preset seeds the next comparison of that engine (v0.2.6's deferral);
 *  - deleting a project keeps its comparisons, unattached;
 *  - the database holds no file contents, read from the bytes on disk.
 */

const SECRET = 'project-secret-token-4c1e';

/**
 * Stubs the native picker, **cycling** through `paths`.
 *
 * A queue that walks off its end and falls back to `paths[0]` is the version this
 * replaced: the pair is picked three times here, and the third pick quietly served
 * a directory, which turned a text diff into no engine at all.
 */
async function stubPair(harness: Harness, paths: string[]): Promise<void> {
  await harness.app.evaluate(({ dialog }, queued: string[]) => {
    let call = 0;
    dialog.showOpenDialog = () =>
      Promise.resolve({ canceled: false, filePaths: [queued[call++ % queued.length] as string] });
  }, paths);
}

test('projects: save, reopen, presets that seed, and a delete that keeps the work', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'twinscope-projects-'));
  const files = await mkdtemp(join(tmpdir(), 'twinscope-projects-files-'));
  const harness = await launchApp({ userDataDir });

  try {
    const before = join(files, 'settings.txt');
    const after = join(files, 'settings.next.txt');
    const root = join(files, 'scope');
    await mkdir(root, { recursive: true });
    await writeFile(before, `token=${SECRET}\nRETRIES=1\nmode=fast\n`);
    await writeFile(after, `token=${SECRET}\nretries=1\nmode=slow\n`);

    await stubPair(harness, [before, after]);

    // ---------- Projects is a real destination now ----------
    await harness.page.getByTestId('nav-projects').click();
    await expect(harness.page.getByTestId('screen-projects')).toBeVisible();
    await expect(harness.page.getByTestId('projects-empty')).toBeVisible();

    // ---------- creating one makes it active, since that is what was meant ----------
    await harness.page.getByTestId('project-name').fill('Service config');
    await harness.page.getByTestId('project-create').click();
    const project = harness.page.locator('[data-testid^="project-"][data-active="true"]');
    await expect(project).toContainText('Service config');
    const projectId = (await project.getAttribute('data-testid'))?.replace('project-', '') ?? '';
    expect(projectId).not.toBe('');

    // ---------- run a comparison and save it with ⌘S ----------
    await harness.page.getByTestId('nav-compare').click();
    await harness.page.getByTestId('pick-file-before').click();
    await harness.page.getByTestId('pick-file-after').click();
    await harness.page.getByTestId('compare-button').click();
    await expect(harness.page.getByTestId('text-diff')).toBeVisible({ timeout: 20_000 });

    // RETRIES=1 → retries=1 is a case-only change, and mode changed: two rows.
    await expect(harness.page.getByTestId('summary-strip')).toContainText('～2 modified');

    await harness.page.keyboard.press('Meta+s');
    await expect(harness.page.getByTestId('saved-toast')).toContainText('settings.txt');

    // ---------- it lands in the project, and in History's Saved tab ----------
    await harness.page.getByTestId('saved-toast-open').click();
    await expect(harness.page.getByTestId(`project-saved-${projectId}`)).toContainText(
      'settings.txt ↔ settings.next.txt',
    );

    await harness.page.getByTestId('nav-history').click();
    await harness.page.getByRole('tab', { name: /^Saved/ }).click();
    await expect(harness.page.getByTestId(`saved-group-project-${projectId}`)).toContainText(
      'settings.txt',
    );
    await harness.screenshot('projects-saved-tab');

    // ---------- capture the options on screen as the project's preset ----------
    // Turn ignore-case on first: the point of a preset is that the *next*
    // comparison starts where this one ended up.
    await harness.page.getByTestId('nav-history').click();
    await harness.page.getByRole('tab', { name: /^Saved/ }).click();
    const savedRow = harness.page.locator('[data-testid^="saved-"]').first();
    await savedRow.click();
    await expect(harness.page.getByTestId('text-diff')).toBeVisible({ timeout: 20_000 });

    await harness.page.getByRole('button', { name: 'Ignore case' }).click();
    // One of the two modifications was case-only, so it stops counting.
    await expect(harness.page.getByTestId('summary-strip')).toContainText('～1 modified');

    await harness.page.getByTestId('nav-projects').click();
    await harness.page.getByTestId(`project-capture-${projectId}`).click();
    await expect(harness.page.getByTestId(`project-presets-${projectId}`)).toContainText('text:');

    // ---------- a preset seeds the next comparison of that engine ----------
    await harness.page.getByTestId('nav-compare').click();
    // Clear both sides first: reopening the saved comparison left them filled, and
    // the point of this step is a comparison started from scratch.
    await harness.page.getByTestId('clear-before').click();
    await harness.page.getByTestId('clear-after').click();
    await harness.page.getByTestId('pick-file-before').click();
    await harness.page.getByTestId('pick-file-after').click();
    await harness.page.getByTestId('compare-button').click();
    await expect(harness.page.getByTestId('text-diff')).toBeVisible({ timeout: 20_000 });
    // Not because the view remembered anything — this is a fresh pair, seeded by
    // `defaultsFor` before the job started.
    await expect(harness.page.getByRole('button', { name: 'Ignore case' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(harness.page.getByTestId('summary-strip')).toContainText('～1 modified');

    // ---------- an ignore glob is remembered per project ----------
    await harness.page.getByTestId('nav-projects').click();
    await harness.page.getByTestId(`project-ignore-input-${projectId}`).fill('dist/**');
    await harness.page.getByTestId(`project-ignore-input-${projectId}`).press('Enter');
    await expect(harness.page.getByTestId(`project-${projectId}`)).toContainText('dist/**');

    // ---------- and so is a folder scope, through the same picker ----------
    await stubPair(harness, [root]);
    await harness.page.getByTestId(`project-pick-root-${projectId}`).click();
    await expect(harness.page.getByTestId(`project-root-${projectId}`)).toContainText('scope');
    await stubPair(harness, [before, after]);

    // ---------- the database holds no contents (Rule 2), read off disk ----------
    const db = new DatabaseSync(join(userDataDir, 'twinscope.db'), { readOnly: true });
    const stored = JSON.stringify([
      ...db.prepare('SELECT * FROM saved_comparisons').all(),
      ...db.prepare('SELECT * FROM projects').all(),
    ]);
    db.close();
    expect(stored).not.toContain(SECRET);
    expect(stored).toContain('settings.next.txt');
    expect(stored).toContain('dist/**');

    // ---------- deleting the project keeps the comparison, unattached ----------
    await harness.page.getByTestId(`project-delete-${projectId}`).click();
    await harness.page.getByTestId(`project-delete-confirm-${projectId}`).click();
    await expect(harness.page.getByTestId(`project-${projectId}`)).toHaveCount(0);
    await expect(harness.page.getByTestId('project-unfiled')).toContainText('settings.txt');

    // …and with no project active, the preset stops seeding.
    await harness.page.getByTestId('nav-compare').click();
    await harness.page.getByTestId('clear-before').click();
    await harness.page.getByTestId('clear-after').click();
    await harness.page.getByTestId('pick-file-before').click();
    await harness.page.getByTestId('pick-file-after').click();
    await harness.page.getByTestId('compare-button').click();
    await expect(harness.page.getByTestId('text-diff')).toBeVisible({ timeout: 20_000 });
    await expect(harness.page.getByRole('button', { name: 'Ignore case' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );

    expect(harness.errors, `errors:\n${harness.errors.join('\n')}`).toEqual([]);
  } finally {
    await harness.close();
    await rm(userDataDir, { recursive: true, force: true });
    await rm(files, { recursive: true, force: true });
  }
});

test('projects: a saved comparison is a definition, so opening it compares again', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'twinscope-saved-'));
  const files = await mkdtemp(join(tmpdir(), 'twinscope-saved-files-'));
  const harness = await launchApp({ userDataDir });

  try {
    const before = join(files, 'a.txt');
    const after = join(files, 'b.txt');
    // A line that *pairs*: 'two' against 'TWO' shares no token, so the text engine
    // would rightly call it a removal plus an addition.
    await writeFile(before, 'one\ntimeout=30\n');
    await writeFile(after, 'one\ntimeout=45\n');

    await harness.app.evaluate(
      ({ dialog }, paths: string[]) => {
        let call = 0;
        dialog.showOpenDialog = () =>
          Promise.resolve({ canceled: false, filePaths: [paths[call++] ?? paths[0]!] });
      },
      [before, after],
    );

    await harness.page.getByTestId('pick-file-before').click();
    await harness.page.getByTestId('pick-file-after').click();
    await harness.page.getByTestId('compare-button').click();
    await expect(harness.page.getByTestId('summary-strip')).toContainText('～1 modified', {
      timeout: 20_000,
    });
    await harness.page.getByTestId('save-comparison').click();
    await expect(harness.page.getByTestId('saved-toast')).toBeVisible();

    // Change the file underneath the saved definition.
    await writeFile(after, 'one\ntimeout=45\nthree\nfour\n');

    await harness.page.getByTestId('nav-projects').click();
    await harness.page.locator('[data-testid^="saved-"]').first().click();

    // Two added lines that did not exist when it was saved: the comparison ran
    // again rather than being restored.
    await expect(harness.page.getByTestId('summary-strip')).toContainText('＋2 added', {
      timeout: 20_000,
    });

    expect(harness.errors, `errors:\n${harness.errors.join('\n')}`).toEqual([]);
  } finally {
    await harness.close();
    await rm(userDataDir, { recursive: true, force: true });
    await rm(files, { recursive: true, force: true });
  }
});
