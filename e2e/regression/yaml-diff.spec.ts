import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, test } from '@playwright/test';
import { launchApp, type Harness } from '../helpers/launch';

/**
 * REGRESSION — v0.2.3: the YAML engine.
 *
 * Files on disk, through the real file picker, because that is the only route that
 * exercises **detection**: a pasted YAML has no `.yaml` on the end of its name and
 * would be detected as text. Only the native dialog is stubbed, as in the folder
 * spec — everything downstream is genuine.
 *
 * What is worth protecting here is that this engine is the JSON core: the tree,
 * the five view modes and the normalisation rail all have to work on day one,
 * because none of them were written for YAML.
 */

const COMPOSE_BEFORE = `version: '3.9'

x-defaults: &defaults
  restart: unless-stopped
  logging:
    driver: json-file

services:
  api:
    <<: *defaults
    image: example/api:1.4.0
    ports:
      - 8080
    environment:
      LOG_LEVEL: info
  worker:
    <<: *defaults
    image: example/worker:1.4.0
`;

const COMPOSE_AFTER = `version: '3.9'

x-defaults: &defaults
  restart: unless-stopped
  logging:
    driver: json-file

services:
  api:
    <<: *defaults
    image: example/api:1.5.0
    ports:
      - 8080
      - 9090
    environment:
      LOG_LEVEL: debug
  cron:
    <<: *defaults
    image: example/cron:1.5.0
`;

/** Writes files into a temp dir and stubs the picker to hand them over in order. */
async function stage(harness: Harness, files: Array<[string, string]>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'twinscope-yaml-'));
  const paths: string[] = [];
  for (const [name, content] of files) {
    const path = join(root, name);
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

test('yaml diff: structural, anchors expanded, and the JSON view reused', async () => {
  const harness = await launchApp();
  let root: string | null = null;

  try {
    root = await stage(harness, [
      ['before.yaml', COMPOSE_BEFORE],
      ['after.yml', COMPOSE_AFTER],
    ]);

    await harness.page.getByTestId('pick-file-before').click();
    await expect(harness.page.getByTestId('drop-before')).toContainText('before.yaml');
    await harness.page.getByTestId('pick-file-after').click();

    // Detection, not an override: `.yaml` and `.yml` both read as YAML.
    const detected = harness.page.getByTestId('detected-bar');
    await expect(detected).toContainText('Structural YAML diff');

    await harness.page.getByTestId('compare-button').click();

    // The JSON view renders it — same testid, because it is the same component.
    const tree = harness.page.getByTestId('json-tree');
    await expect(tree).toBeVisible({ timeout: 20_000 });

    const strip = harness.page.getByTestId('summary-strip');
    // api's image and LOG_LEVEL changed, a port was added, worker became cron.
    await expect(strip).toContainText('added');
    await expect(strip).toContainText('modified');

    // ---------- merge keys are applied, so `<<` is never a row ----------
    // Without `merge: true` at parse time the value keeps a literal `<<` key.
    await expect(tree).not.toContainText('<<');
    // And the proof it was applied rather than dropped: the added `cron` service
    // has three keys — `image` plus the two it inherits. Unmerged it would be two,
    // `image` and `<<`.
    await expect(tree.locator('[data-path="$.services.cron"]')).toContainText('3 keys');

    await harness.screenshot('yaml-tree-dark');

    // ---------- the five view modes are the JSON engine's, working here ----------
    await harness.page.getByRole('tab', { name: 'Tree' }).click();
    await expect(tree).toHaveAttribute('data-mode', 'tree');
    await harness.page.getByRole('tab', { name: 'Raw' }).click();
    await expect(harness.page.getByTestId('json-raw')).toContainText('x-defaults: &defaults');
    await harness.page.getByRole('tab', { name: 'Side-by-side' }).click();
    await expect(tree).toHaveAttribute('data-mode', 'side');

    // ---------- and so is the normalisation rail, which re-runs the engine ----------
    const before = await strip.textContent();
    await harness.page.getByTestId('workspace-search').fill('image');
    await expect(tree).toContainText('image');
    await harness.page.getByTestId('workspace-search').fill('');
    expect(await strip.textContent()).toBe(before);

    expect(harness.errors, `errors:\n${harness.errors.join('\n')}`).toEqual([]);
  } finally {
    await harness.close();
    if (root !== null) await rm(root, { recursive: true, force: true });
  }
});

test('yaml diff: an anchor and its expansion are the same data, and it says so', async () => {
  const harness = await launchApp();
  let root: string | null = null;

  try {
    root = await stage(harness, [
      ['anchored.yaml', 'defaults: &d\n  retries: 3\nprod:\n  <<: *d\n'],
      ['expanded.yaml', 'defaults:\n  retries: 3\nprod:\n  retries: 3\n'],
    ]);

    await harness.page.getByTestId('pick-file-before').click();
    await harness.page.getByTestId('pick-file-after').click();
    await harness.page.getByTestId('compare-button').click();

    await expect(harness.page.getByTestId('json-tree')).toBeVisible({ timeout: 20_000 });
    const strip = harness.page.getByTestId('summary-strip');
    await expect(strip).toContainText('＋0 added');
    await expect(strip).toContainText('－0 removed');
    await expect(strip).toContainText('～0 modified');

    // Rule 3: an identical verdict that surprises the reader has to explain itself.
    await harness.page.getByRole('tab', { name: 'Tree' }).click();
    await expect(harness.page.getByTestId('json-explain')).toContainText('Expanded 1 alias');

    expect(harness.errors, `errors:\n${harness.errors.join('\n')}`).toEqual([]);
  } finally {
    await harness.close();
    if (root !== null) await rm(root, { recursive: true, force: true });
  }
});

test('yaml diff: a YAML compares against the JSON that means the same thing', async () => {
  const harness = await launchApp();
  let root: string | null = null;

  try {
    root = await stage(harness, [
      ['config.yaml', 'name: api\nports:\n  - 8080\n  - 9090\ndebug: false\n'],
      ['config.json', '{"name":"api","ports":[8080,9090],"debug":false}'],
    ]);

    await harness.page.getByTestId('pick-file-before').click();
    await harness.page.getByTestId('pick-file-after').click();

    const detected = harness.page.getByTestId('detected-bar');
    // The mismatch chip has to name the engine that will actually run — it used to
    // claim "comparing as text" whatever the pair.
    await expect(detected).toContainText('Different kinds — comparing as structural yaml');

    await harness.page.getByTestId('compare-button').click();
    await expect(harness.page.getByTestId('json-tree')).toBeVisible({ timeout: 20_000 });
    await expect(harness.page.getByTestId('summary-strip')).toContainText('～0 modified');
    await expect(harness.page.getByTestId('summary-strip')).toContainText('yaml ↔ json');

    expect(harness.errors, `errors:\n${harness.errors.join('\n')}`).toEqual([]);
  } finally {
    await harness.close();
    if (root !== null) await rm(root, { recursive: true, force: true });
  }
});

test('yaml diff: unparseable YAML offers the text engine instead', async () => {
  const harness = await launchApp();
  let root: string | null = null;

  try {
    root = await stage(harness, [
      ['broken.yaml', 'services:\n  api:\n    ports: [8080, 9090\n'],
      ['ok.yaml', 'services:\n  api:\n    ports: [8080]\n'],
    ]);

    await harness.page.getByTestId('pick-file-before').click();
    await harness.page.getByTestId('pick-file-after').click();
    await harness.page.getByTestId('compare-button').click();

    const error = harness.page.getByTestId('job-error');
    await expect(error).toBeVisible({ timeout: 20_000 });
    await expect(error).toContainText('is not valid YAML');
    // The location comes from the parser, not from us guessing at an offset.
    await expect(error).toContainText('line');

    // An engine that fails can still offer a way out — the same contract MVP-5
    // introduced for unparseable JSON.
    await harness.page.getByTestId('error-fallback').click();
    await expect(harness.page.getByTestId('text-diff')).toBeVisible({ timeout: 20_000 });

    expect(harness.errors, `errors:\n${harness.errors.join('\n')}`).toEqual([]);
  } finally {
    await harness.close();
    if (root !== null) await rm(root, { recursive: true, force: true });
  }
});
