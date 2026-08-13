import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, test } from '@playwright/test';
import { launchApp, type Harness } from '../helpers/launch';

/**
 * REGRESSION — v0.2.10: dependency comparison.
 *
 * Filenames are the whole point of detection here, so the files go through the real
 * picker with their real names: `package.json` used to detect as `json` and get a
 * structural tree, which answers the wrong question.
 */

const MANIFEST_BEFORE = JSON.stringify(
  {
    name: 'example-app',
    dependencies: {
      react: '^19.0.0',
      lodash: '^4.17.20',
      'left-pad': '^1.3.0',
      express: '^5.0.0',
    },
    devDependencies: { vitest: '^4.0.0' },
  },
  null,
  2,
);

const MANIFEST_AFTER = JSON.stringify(
  {
    name: 'example-app',
    dependencies: {
      react: '^19.0.0',
      lodash: '^4.18.0',
      express: '^4.19.0',
      zod: '^4.0.0',
    },
    devDependencies: { vitest: '^4.0.1' },
  },
  null,
  2,
);

/** An npm lockfile, which is the only kind that records licences. */
function npmLock(packages: Record<string, { version: string; license?: string }>): string {
  return JSON.stringify(
    {
      name: 'example-app',
      lockfileVersion: 3,
      packages: {
        '': { name: 'example-app', dependencies: { react: '^19.0.0', lodash: '^4.17.0' } },
        ...Object.fromEntries(
          Object.entries(packages).map(([name, entry]) => [`node_modules/${name}`, entry]),
        ),
      },
    },
    null,
    2,
  );
}

async function stage(harness: Harness, files: Array<[string, string]>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'twinscope-deps-'));
  const paths: string[] = [];
  for (const [name, content] of files) {
    // Each file needs its real name, so they go in their own directory.
    const directory = join(root, `side-${paths.length}`);
    const { mkdir } = await import('node:fs/promises');
    await mkdir(directory, { recursive: true });
    const path = join(directory, name);
    await writeFile(path, content);
    paths.push(path);
  }

  await harness.app.evaluate(({ dialog }, queued: string[]) => {
    let call = 0;
    dialog.showOpenDialog = () =>
      Promise.resolve({ canceled: false, filePaths: [queued[call++] ?? queued[0]!] });
  }, paths);

  return root;
}

async function open(harness: Harness): Promise<void> {
  await harness.page.getByTestId('pick-file-before').click();
  await harness.page.getByTestId('pick-file-after').click();
  await harness.page.getByTestId('compare-button').click();
}

test('deps: two manifests give bumps, and say what they cannot show', async () => {
  const harness = await launchApp();
  let root: string | null = null;

  try {
    root = await stage(harness, [
      ['package.json', MANIFEST_BEFORE],
      ['package.json', MANIFEST_AFTER],
    ]);

    await harness.page.getByTestId('pick-file-before').click();
    await harness.page.getByTestId('pick-file-after').click();
    // Detection, on the filename: two package.json files are a dependency question.
    await expect(harness.page.getByTestId('detected-bar')).toContainText('Dependency diff');
    await harness.page.getByTestId('compare-button').click();

    const view = harness.page.getByTestId('deps-view');
    await expect(view).toBeVisible({ timeout: 20_000 });

    const strip = harness.page.getByTestId('summary-strip');
    // zod added, left-pad removed, lodash/express/vitest changed, react unchanged.
    await expect(strip).toContainText('＋1 added');
    await expect(strip).toContainText('－1 removed');
    await expect(strip).toContainText('～3 modified');

    // ---------- each bump is sized, and a downgrade is called out ----------
    await expect(harness.page.getByTestId('deps-bump-lodash')).toHaveText('minor');
    await expect(harness.page.getByTestId('deps-bump-vitest')).toHaveText('patch');
    // express went 5.x → 4.19: a major change *and* a rollback.
    await expect(harness.page.getByTestId('deps-bump-express')).toHaveText('major ↓');
    await expect(strip).toContainText('1 major');
    await expect(strip).toContainText('1 downgrades');

    // ---------- a manifest pair says what it cannot tell you (Rule 3) ----------
    await expect(harness.page.getByTestId('deps-declared')).toContainText('declared ranges only');
    await expect(harness.page.getByTestId('deps-notes')).toContainText('Compare the two lockfiles');
    // Plain prose, not markdown: this text is rendered as-is in the notes list.
    await expect(harness.page.getByTestId('deps-notes')).toContainText(
      'a rollback, not an upgrade',
    );
    await expect(harness.page.getByTestId('deps-notes')).not.toContainText('*down*');

    // ---------- unchanged rows are hidden until asked for ----------
    await expect(view.locator('[data-name="react"]')).toHaveCount(0);
    await harness.page.getByRole('button', { name: 'Show unchanged' }).click();
    await expect(view.locator('[data-name="react"]')).toHaveAttribute('data-status', 'same');

    // ---------- "needs a look" is the review filter ----------
    await harness.page.getByRole('tab', { name: 'Needs a look' }).click();
    await expect(view.locator('[data-name="express"]')).toHaveCount(1);
    await expect(view.locator('[data-name="lodash"]')).toHaveCount(0);
    await harness.page.getByRole('tab', { name: 'All' }).click();

    await harness.screenshot('deps-manifests');

    // ---------- dev dependencies are part of the comparison, and can be dropped ----------
    await harness.page.getByRole('button', { name: 'Dev dependencies' }).click();
    await expect(view.locator('[data-name="vitest"]')).toHaveCount(0, { timeout: 20_000 });
    await expect(strip).toContainText('～2 modified');

    expect(harness.errors, `errors:\n${harness.errors.join('\n')}`).toEqual([]);
  } finally {
    await harness.close();
    if (root !== null) await rm(root, { recursive: true, force: true });
  }
});

test('deps: two lockfiles add resolved versions, transitive counts and licences', async () => {
  const harness = await launchApp();
  let root: string | null = null;

  try {
    root = await stage(harness, [
      [
        'package-lock.json',
        npmLock({
          react: { version: '19.2.0', license: 'MIT' },
          lodash: { version: '4.17.20', license: 'MIT' },
          scheduler: { version: '0.30.0', license: 'MIT' },
        }),
      ],
      [
        'package-lock.json',
        npmLock({
          react: { version: '19.2.8', license: 'MIT' },
          lodash: { version: '4.17.21', license: 'AGPL-3.0' },
          scheduler: { version: '0.31.0', license: 'MIT' },
          'tiny-invariant': { version: '1.3.3', license: 'MIT' },
        }),
      ],
    ]);

    await open(harness);
    const view = harness.page.getByTestId('deps-view');
    await expect(view).toBeVisible({ timeout: 20_000 });

    // ---------- resolved versions, not ranges ----------
    await expect(harness.page.getByTestId('deps-resolved')).toContainText('3 → 4 packages');
    await expect(view.locator('[data-name="react"]')).toContainText('19.2.0');
    await expect(view.locator('[data-name="react"]')).toContainText('19.2.8');

    // ---------- a transitive package is listed as such, not as a dependency ----------
    await expect(view.locator('[data-name="scheduler"]')).toHaveAttribute(
      'data-transitive',
      'true',
    );
    await expect(view.locator('[data-name="tiny-invariant"]')).toHaveAttribute(
      'data-status',
      'add',
    );

    // ---------- the licence change, which only an npm lockfile can report ----------
    await expect(harness.page.getByTestId('deps-licence-lodash')).toContainText('MIT → AGPL-3.0');
    await expect(harness.page.getByTestId('summary-strip')).toContainText('1 licences');

    await harness.screenshot('deps-lockfiles');

    // ---------- transitive rows can be dropped from the list but stay counted ----------
    await harness.page.getByRole('button', { name: 'Transitive' }).click();
    await expect(view.locator('[data-name="scheduler"]')).toHaveCount(0, { timeout: 20_000 });
    await expect(harness.page.getByTestId('deps-resolved')).toContainText('3 → 4 packages');

    expect(harness.errors, `errors:\n${harness.errors.join('\n')}`).toEqual([]);
  } finally {
    await harness.close();
    if (root !== null) await rm(root, { recursive: true, force: true });
  }
});

test('deps: a broken manifest offers text, and an ordinary .json is untouched', async () => {
  const harness = await launchApp();
  let root: string | null = null;

  try {
    root = await stage(harness, [
      ['package.json', '{ "dependencies": '],
      ['package.json', MANIFEST_AFTER],
      ['data.json', '{"a":1}'],
      ['data.json', '{"a":2}'],
    ]);

    await open(harness);
    const error = harness.page.getByTestId('job-error');
    await expect(error).toBeVisible({ timeout: 20_000 });
    await expect(error).toContainText('not valid JSON');
    await harness.page.getByTestId('error-fallback').click();
    await expect(harness.page.getByTestId('text-diff')).toBeVisible({ timeout: 20_000 });

    // ---------- an ordinary .json still gets the structural engine ----------
    await harness.page.getByTestId('back-button').click();
    await harness.page.getByTestId('pick-file-before').click();
    await harness.page.getByTestId('pick-file-after').click();
    await expect(harness.page.getByTestId('detected-bar')).toContainText('Structural JSON diff');

    expect(harness.errors, `errors:\n${harness.errors.join('\n')}`).toEqual([]);
  } finally {
    await harness.close();
    if (root !== null) await rm(root, { recursive: true, force: true });
  }
});
