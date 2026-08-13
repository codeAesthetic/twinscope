import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, test } from '@playwright/test';
import { launchApp } from '../helpers/launch';

/**
 * REGRESSION — v0.2.1: the git engine, its intake panel and its view.
 *
 * The repository is real: the *test* process runs `git init`, commits twice and
 * dirties the working tree. Nothing about git is stubbed, so what this proves is
 * that the app reads a genuine repository through a genuine `git` — which is the
 * whole point of shelling out rather than bundling a git implementation.
 *
 * Only the native folder dialog is stubbed, for the same reason the folder spec
 * stubs it: Playwright cannot drive an OS dialog.
 */

const FIRST_COMMIT = {
  'src/keep.ts': 'export const keep = 1;\n',
  'src/edit.ts': 'export const value = 1;\n',
  'src/gone.ts': 'export const gone = true;\n',
  'ui/OldModal.tsx': 'export function Modal() {\n  return null;\n}\n',
  'README.md': '# before\n',
};

const SECOND_COMMIT = {
  'src/edit.ts': 'export const value = 2;\nexport const extra = 3;\n',
  'src/added.ts': 'export const added = true;\n',
  'ui/Modal.tsx': 'export function Modal() {\n  return null;\n}\n',
};

function run(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'TwinScope Test',
      GIT_AUTHOR_EMAIL: 'test@example.invalid',
      GIT_COMMITTER_NAME: 'TwinScope Test',
      GIT_COMMITTER_EMAIL: 'test@example.invalid',
    },
  });
}

async function write(root: string, files: Record<string, string>): Promise<void> {
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, content);
  }
}

/**
 * A repository with two commits and an uncommitted edit.
 *
 * `-c init.defaultBranch=main` rather than relying on the machine's git config:
 * a run on a host whose default is `master` would otherwise assert against the
 * wrong branch name.
 */
async function buildRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'twinscope-git-'));
  run(root, ['-c', 'init.defaultBranch=main', 'init', '--quiet', root]);
  run(root, ['config', 'user.name', 'TwinScope Test']);
  run(root, ['config', 'user.email', 'test@example.invalid']);
  run(root, ['config', 'commit.gpgsign', 'false']);

  await write(root, FIRST_COMMIT);
  run(root, ['add', '-A']);
  run(root, ['commit', '--quiet', '-m', 'first']);

  await write(root, SECOND_COMMIT);
  await rm(join(root, 'src/gone.ts'));
  await rm(join(root, 'ui/OldModal.tsx'));
  run(root, ['add', '-A']);
  run(root, ['commit', '--quiet', '-m', 'second']);

  // An uncommitted change, so HEAD → working tree has something to show.
  await writeFile(join(root, 'README.md'), '# before\n\nuncommitted line\n');
  // And an UNTRACKED file. `git diff` never reports one, so the engine merges in
  // `ls-files --others --exclude-standard` and says so in a note — the behaviour that
  // was silently missing until v0.2.2, and the note that reached an exported report but
  // never the screen until the notes panel existed.
  await writeFile(join(root, 'src/brand-new.ts'), 'export const brandNew = true;\n');

  return root;
}

test('git diff: ref pickers, statuses, line counts, options and blob drill-in', async () => {
  let repo: string | null = null;
  const harness = await launchApp();

  try {
    repo = await buildRepo();
    const first = run(repo, ['rev-parse', '--short', 'HEAD~1']).trim();

    await harness.app.evaluate(({ dialog }, path: string) => {
      dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [path] });
    }, repo);

    // ---------- the quick card is live now, and opens the panel ----------
    await harness.page.getByTestId('quick-git').click();
    const panel = harness.page.getByTestId('git-panel');
    await expect(panel).toBeVisible();

    // ---------- probing fills both refs and reports the repository root ----------
    await harness.page.getByTestId('git-pick-repo').click();
    const beforeField = harness.page.getByTestId('git-ref-before');
    await expect(beforeField).toHaveValue('main', { timeout: 20_000 });
    // The default AFTER side is the working tree, because the tree is dirty.
    await expect(harness.page.getByTestId('git-ref-after')).toHaveValue('WORKTREE');
    await expect(panel).toContainText('uncommitted changes');
    await expect(harness.page.getByTestId('git-repo-root')).toContainText('twinscope-git-');

    // Two identical refs are not a comparison, and the panel says so rather than
    // starting a job that cannot mean anything.
    await harness.page.getByTestId('git-ref-after').fill('main');
    await expect(harness.page.getByTestId('git-same-ref')).toBeVisible();
    await expect(harness.page.getByTestId('git-compare')).toBeDisabled();

    // ---------- commit ↔ commit ----------
    await beforeField.fill(first);
    await harness.page.getByTestId('git-ref-after').fill('main');
    await harness.page.getByTestId('git-compare').click();

    const list = harness.page.getByTestId('git-diff');
    await expect(list).toBeVisible({ timeout: 20_000 });

    const strip = harness.page.getByTestId('summary-strip');
    // added: src/added.ts · removed: src/gone.ts · modified: src/edit.ts + the
    // rename. git pairs OldModal.tsx → Modal.tsx itself at 100% similarity.
    await expect(strip).toContainText('＋1 added');
    await expect(strip).toContainText('－1 removed');
    await expect(strip).toContainText('～2 modified');
    await expect(strip).toContainText('1 renamed');

    await expect(list.locator('[data-path="src/added.ts"]')).toHaveAttribute('data-status', 'add');
    await expect(list.locator('[data-path="src/gone.ts"]')).toHaveAttribute('data-status', 'del');
    await expect(list.locator('[data-path="src/edit.ts"]')).toHaveAttribute('data-status', 'mod');
    await expect(list.locator('[data-path="ui/Modal.tsx"]')).toHaveAttribute(
      'data-status',
      'rename',
    );
    // An unchanged file is not in a git diff at all — unlike a folder diff.
    await expect(list.locator('[data-path="src/keep.ts"]')).toHaveCount(0);

    // ---------- line counts come from git, per file and in total ----------
    const edited = list.locator('[data-path="src/edit.ts"]');
    await expect(edited.locator('.dd-gitplus')).toHaveText('＋2');
    await expect(edited.locator('.dd-gitminus')).toHaveText('－1');
    await expect(strip).toContainText('＋');
    await expect(list.locator('[data-path="ui/Modal.tsx"]')).toContainText('from ui/OldModal.tsx');

    // ---------- rename detection is an engine option, not a view filter ----------
    // Rule 3: turning it off must change the *counts*, which means re-running git.
    await harness.page.getByRole('button', { name: 'Detect renames' }).click();
    await expect(list.locator('[data-path="ui/Modal.tsx"]')).toHaveAttribute('data-status', 'add', {
      timeout: 20_000,
    });
    await expect(strip).toContainText('＋2 added');
    await expect(strip).not.toContainText('renamed');
    await harness.page.getByRole('button', { name: 'Detect renames' }).click();
    await expect(list.locator('[data-path="ui/Modal.tsx"]')).toHaveAttribute(
      'data-status',
      'rename',
      { timeout: 20_000 },
    );

    // ---------- the toolbar filter and ⌘F filter compose ----------
    await harness.page.getByRole('tab', { name: 'Deleted' }).click();
    await expect(list.locator('[data-path="src/gone.ts"]')).toHaveCount(1);
    await expect(list.locator('[data-path="src/added.ts"]')).toHaveCount(0);
    await harness.page.getByRole('tab', { name: 'All' }).click();

    await harness.page.getByTestId('workspace-search').fill('*.tsx');
    await expect(list.locator('[data-path="ui/Modal.tsx"]')).toHaveCount(1);
    await expect(list.locator('[data-path="src/edit.ts"]')).toHaveCount(0);
    await harness.page.getByTestId('workspace-search').fill('');

    // ---------- change navigation walks the visible list ----------
    await expect(harness.page.getByTestId('change-position')).toHaveText('– / 4');

    await harness.screenshot('git-diff-dark');

    // ---------- drill-in reads two `git show` blobs, neither of which is on disk ----------
    await edited.dblclick();
    await expect(harness.page.getByTestId('text-diff')).toBeVisible({ timeout: 20_000 });
    await expect(harness.page.getByTestId('summary-strip')).toContainText('～1 modified');
    await expect(harness.page.getByTestId('text-diff')).toContainText('export const extra = 3;');

    // ---------- and back, with the file list intact and not re-run ----------
    await harness.page.getByTestId('breadcrumb-back').click();
    await expect(harness.page.getByTestId('git-diff')).toBeVisible();
    await expect(harness.page.getByTestId('summary-strip')).toContainText('1 renamed');

    // ---------- an added file drills in too: its BEFORE blob is simply absent ----------
    await list.locator('[data-path="src/added.ts"]').dblclick();
    await expect(harness.page.getByTestId('text-diff')).toBeVisible({ timeout: 20_000 });
    await expect(harness.page.getByTestId('summary-strip')).toContainText('＋1 added');
    await harness.page.getByTestId('breadcrumb-back').click();

    // ---------- HEAD ↔ working tree, the case the panel defaults to ----------
    await harness.page.getByTestId('back-button').click();
    await harness.page.getByTestId('quick-git').click();
    await harness.page.getByTestId('git-pick-repo').click();
    await expect(harness.page.getByTestId('git-ref-after')).toHaveValue('WORKTREE', {
      timeout: 20_000,
    });
    await harness.page.getByTestId('git-compare').click();
    await expect(harness.page.getByTestId('git-diff')).toBeVisible({ timeout: 20_000 });
    await expect(harness.page.getByTestId('git-after-label')).toHaveText('working tree');
    await expect(
      harness.page.getByTestId('git-diff').locator('[data-path="README.md"]'),
    ).toHaveAttribute('data-status', 'mod');

    // ---------- the untracked file is here, and the screen says why ----------
    await expect(
      harness.page.getByTestId('git-diff').locator('[data-path="src/brand-new.ts"]'),
    ).toHaveAttribute('data-status', 'add');

    const notes = harness.page.getByTestId('git-notes');
    await expect(notes).toBeVisible();
    await expect(notes).toContainText('untracked');

    expect(harness.errors, `errors:\n${harness.errors.join('\n')}`).toEqual([]);
  } finally {
    await harness.close();
    if (repo !== null) await rm(repo, { recursive: true, force: true });
  }
});

test('git: a folder that is not a repository is an answer, not an error', async () => {
  let plain: string | null = null;
  const harness = await launchApp();

  try {
    plain = await mkdtemp(join(tmpdir(), 'twinscope-plain-'));
    await writeFile(join(plain, 'file.txt'), 'not a repo\n');

    await harness.app.evaluate(({ dialog }, path: string) => {
      dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [path] });
    }, plain);

    await harness.page.getByTestId('quick-git').click();
    await harness.page.getByTestId('git-pick-repo').click();

    await expect(harness.page.getByTestId('git-error')).toContainText('not a git repository', {
      timeout: 20_000,
    });
    // No refs, so no way to start a job that could not work.
    await expect(harness.page.getByTestId('git-compare')).toHaveCount(0);

    expect(harness.errors, `errors:\n${harness.errors.join('\n')}`).toEqual([]);
  } finally {
    await harness.close();
    if (plain !== null) await rm(plain, { recursive: true, force: true });
  }
});
