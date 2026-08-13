import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, test } from '@playwright/test';
import { launchApp } from '../helpers/launch';

/**
 * REGRESSION — MVP-6: the folder engine and its tree view.
 *
 * The fixture trees are real directories on disk, and they reach the app through
 * the folder picker with only the native dialog stubbed. Stubbing the dialog
 * rather than the intake keeps everything downstream — IPC, detection, the
 * worker, the view — genuine.
 */
const FIXTURE = {
  before: {
    'src/keep.ts': 'export const keep = 1;\n',
    'src/edit.ts': 'export const value = 1;\n',
    'src/gone.ts': 'export const gone = true;\n',
    'ui/OldModal.tsx': 'export function Modal() {}\n',
    'deep/nested/moved.ts': 'export const moved = "this file travels";\n',
    'README.md': '# before\n',
  },
  after: {
    'src/keep.ts': 'export const keep = 1;\n',
    'src/edit.ts': 'export const value = 2;\nexport const extra = 3;\n',
    'src/added.ts': 'export const added = true;\n',
    'ui/Modal.tsx': 'export function Modal() {}\n',
    'moved.ts': 'export const moved = "this file travels";\n',
    'README.md': '# before\n',
  },
};

/** Writes one fixture tree into a fresh temp directory. */
async function build(spec: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'twinscope-e2e-'));
  for (const [path, content] of Object.entries(spec)) {
    const full = join(root, path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, content);
  }
  return root;
}

test('folder diff: statuses, filters, rename detection and drill-in', async () => {
  const harness = await launchApp();
  const roots: string[] = [];

  try {
    roots.push(await build(FIXTURE.before), await build(FIXTURE.after));
    const [before, after] = roots as [string, string];

    // Stub the native picker for this run — Playwright cannot drive an OS dialog.
    await harness.app.evaluate(
      ({ dialog }, paths: string[]) => {
        let call = 0;
        dialog.showOpenDialog = () =>
          Promise.resolve({ canceled: false, filePaths: [paths[call++] ?? paths[0]!] });
      },
      [before, after],
    );

    await harness.page.getByTestId('pick-folder-before').click();
    await expect(harness.page.getByTestId('drop-before')).toContainText('folder');
    await harness.page.getByTestId('pick-folder-after').click();

    await expect(harness.page.getByTestId('detected-bar')).toContainText('File tree diff');
    await harness.page.getByTestId('compare-button').click();

    const tree = harness.page.getByTestId('folder-tree');
    await expect(tree).toBeVisible({ timeout: 20_000 });

    // ---------- statuses come from metadata, not from reading every file ----------
    const strip = harness.page.getByTestId('summary-strip');
    // The rename pair still counts as one addition and one removal — the note
    // explains the pairing rather than hiding either half.
    await expect(strip).toContainText('＋3 added');
    await expect(strip).toContainText('－3 removed');
    await expect(strip).toContainText('～1 modified');
    await expect(strip).toContainText('2 identical');

    await expect(tree.locator('[data-path="src/added.ts"]')).toHaveAttribute('data-status', 'add');
    await expect(tree.locator('[data-path="src/gone.ts"]')).toHaveAttribute('data-status', 'del');
    await expect(tree.locator('[data-path="src/edit.ts"]')).toHaveAttribute('data-status', 'mod');
    await expect(tree.locator('[data-path="src/keep.ts"]')).toHaveAttribute('data-status', 'same');

    // ---------- a directory inherits its subtree, so a collapsed view still reads ----------
    await expect(tree.locator('[data-path="src"]')).toHaveAttribute('data-status', 'mod');

    // ---------- the absent side is a marked gap, not a blank line ----------
    const added = tree.locator('[data-path="src/added.ts"] .dd-fcell').first();
    await expect(added).toHaveAttribute('data-status', 'nil');

    // ---------- rename detection pairs the two names, with a score (v0.2.11) ----------
    await expect(tree.locator('[data-path="ui/Modal.tsx"]')).toContainText(
      'renamed from ui/OldModal.tsx (100%)',
    );
    // A file that moved *up two directories* is one rename. v1 required the same
    // parent folder and reported this as a deletion plus an addition.
    await expect(tree.locator('[data-path="moved.ts"]')).toContainText(
      'renamed from deep/nested/moved.ts (100%)',
    );
    await expect(strip).toContainText('2 renamed');

    await harness.screenshot('folder-tree-dark');

    // ---------- filters compose with the name filter ----------
    await harness.page.getByRole('tab', { name: 'Modified' }).click();
    await expect(tree.locator('[data-path="src/edit.ts"]')).toHaveCount(1);
    await expect(tree.locator('[data-path="src/keep.ts"]')).toHaveCount(0);

    await harness.page.getByRole('tab', { name: 'All' }).click();
    await harness.page.getByTestId('workspace-search').fill('*.md');
    await expect(tree.locator('[data-path="README.md"]')).toHaveCount(1);
    await expect(tree.locator('[data-path="src/edit.ts"]')).toHaveCount(0);
    await harness.page.getByTestId('workspace-search').fill('');

    // ---------- change navigation walks changed files only ----------
    await expect(harness.page.getByTestId('change-position')).toHaveText('– / 7');

    // ---------- drill in: the file pair opens as its own text diff ----------
    await tree.locator('[data-path="src/edit.ts"]').dblclick();
    await expect(harness.page.getByTestId('text-diff')).toBeVisible({ timeout: 20_000 });
    await expect(harness.page.getByTestId('summary-strip')).toContainText('～1 modified');

    // ---------- and the breadcrumb returns to the tree with its result intact ----------
    await harness.page.getByTestId('breadcrumb-back').click();
    await expect(harness.page.getByTestId('folder-tree')).toBeVisible();
    await expect(harness.page.getByTestId('summary-strip')).toContainText('2 identical');

    expect(harness.errors, `errors:\n${harness.errors.join('\n')}`).toEqual([]);
  } finally {
    await harness.close();
    await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
  }
});
