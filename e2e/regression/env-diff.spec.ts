import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, test } from '@playwright/test';
import { launchApp, type Harness } from '../helpers/launch';

/**
 * REGRESSION — v0.3.7: config comparison, and the masking that is its point.
 *
 * The assertion that matters is the **exported report**: masking happens in the
 * engine precisely so that the view, the clipboard, the report and the CLI cannot
 * each leak separately, and an export is the artefact people email. A spec that only
 * looked at the screen would pass while the feature leaked.
 */

const SECRET_BEFORE = 'p0stgres-Sup3r-S3cret-Value';
const SECRET_AFTER = 'p0stgres-R0tated-S3cret-Value';

const ENV_BEFORE = [
  '# service configuration',
  'PORT=3000',
  'LOG_LEVEL=info',
  `DATABASE_URL=postgres://app:${SECRET_BEFORE}@db.internal:5432/app`,
  'FEATURE_BETA=',
  'RETIRED_FLAG=on',
  '',
].join('\n');

const ENV_AFTER = [
  '# service configuration',
  'PORT=3000',
  'LOG_LEVEL=debug',
  `DATABASE_URL=postgres://app:${SECRET_AFTER}@db.internal:5432/app`,
  'FEATURE_BETA=true',
  'NEW_TIMEOUT_MS=250',
  '',
].join('\n');

async function stage(harness: Harness, files: Array<[string, string]>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'twinscope-env-'));
  const paths: string[] = [];
  for (const [name, content] of files) {
    const path = join(root, name);
    await writeFile(path, content);
    paths.push(path);
  }
  await harness.app.evaluate(({ dialog }, queued: string[]) => {
    let call = 0;
    dialog.showOpenDialog = () =>
      Promise.resolve({ canceled: false, filePaths: [queued[call++ % queued.length] as string] });
  }, paths);
  return root;
}

test('config diff: secrets are masked in the view, the clipboard and the report', async () => {
  const harness = await launchApp();
  let root: string | null = null;

  try {
    root = await stage(harness, [
      ['.env.staging', ENV_BEFORE],
      ['.env.production', ENV_AFTER],
    ]);

    await harness.page.getByTestId('pick-file-before').click();
    await harness.page.getByTestId('pick-file-after').click();
    await expect(harness.page.getByTestId('detected-bar')).toContainText('Config diff');

    await harness.page.getByTestId('compare-button').click();
    const view = harness.page.getByTestId('env-view');
    await expect(view).toBeVisible({ timeout: 20_000 });

    // ---------- the secret is not on screen ----------
    await expect(view).toContainText('DATABASE_URL');
    await expect(view).not.toContainText(SECRET_BEFORE);
    await expect(view).not.toContainText(SECRET_AFTER);
    await expect(harness.page.getByTestId('env-secret-DATABASE_URL')).toBeVisible();
    // …and the change is still reported, which is the half that matters.
    await expect(view.locator('[data-envkey="DATABASE_URL"]')).toHaveAttribute(
      'data-state',
      'changed',
    );

    // ---------- empty and absent are different rows ----------
    await expect(view.locator('[data-envkey="FEATURE_BETA"]')).toHaveAttribute(
      'data-state',
      'filled',
    );
    await expect(view.locator('[data-envkey="RETIRED_FLAG"]')).toHaveAttribute(
      'data-state',
      'removed',
    );
    await expect(view.locator('[data-envkey="NEW_TIMEOUT_MS"]')).toHaveAttribute(
      'data-state',
      'added',
    );

    await harness.screenshot('env-masked');

    // ---------- an exported report carries the mask, not the secret ----------
    const reportPath = join(root, 'report.html');
    await harness.app.evaluate(({ dialog }, path: string) => {
      dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath: path });
    }, reportPath);
    await harness.page.getByTestId('export-button').click();
    await harness.page.getByTestId('export-html').click();
    await expect(harness.page.getByTestId('export-toast')).toContainText('Report saved');

    const report = await readFile(reportPath, 'utf8');
    expect(report).toContain('DATABASE_URL');
    expect(report).toContain('LOG_LEVEL');
    // The leak that matters is the one you send.
    expect(report).not.toContain(SECRET_BEFORE);
    expect(report).not.toContain(SECRET_AFTER);

    // ---------- copying the changes carries the mask too ----------
    await harness.page.getByTestId('env-copy').click();
    const clipboard = await harness.app.evaluate(({ clipboard: system }) => system.readText());
    expect(clipboard).toContain('DATABASE_URL');
    expect(clipboard).not.toContain(SECRET_BEFORE);

    // ---------- showing secrets is explicit, per comparison, and announced ----------
    await harness.page.getByRole('button', { name: 'Show secrets' }).click();
    await expect(harness.page.getByTestId('env-reveal-warning')).toBeVisible({ timeout: 20_000 });
    await expect(view).toContainText(SECRET_AFTER);
    // Turning it off puts the mask back, by re-running the engine.
    await harness.page.getByRole('button', { name: 'Show secrets' }).click();
    await expect(view).not.toContainText(SECRET_AFTER, { timeout: 20_000 });

    expect(harness.errors, `errors:\n${harness.errors.join('\n')}`).toEqual([]);
  } finally {
    if (root !== null) await rm(root, { recursive: true, force: true });
    await harness.close();
  }
});

test('config diff: two manifests compare by object, not by position', async () => {
  const harness = await launchApp();
  let root: string | null = null;

  const service = [
    'apiVersion: v1',
    'kind: Service',
    'metadata:',
    '  name: web',
    '  namespace: prod',
    'spec:',
    '  type: ClusterIP',
    '',
  ].join('\n');

  const deployment = (replicas: number): string =>
    [
      'apiVersion: apps/v1',
      'kind: Deployment',
      'metadata:',
      '  name: api',
      '  namespace: prod',
      'spec:',
      `  replicas: ${replicas}`,
      '',
    ].join('\n');

  const secret = (value: string): string =>
    [
      'apiVersion: v1',
      'kind: Secret',
      'metadata:',
      '  name: creds',
      'data:',
      `  password: ${value}`,
      '',
    ].join('\n');

  try {
    root = await stage(harness, [
      // before: Service, Deployment(2), Secret("hunter2")
      ['cluster.before.yaml', `${service}---\n${deployment(2)}---\n${secret('aHVudGVyMg==')}`],
      // after: the same three objects in a different order, replicas 4, same secret
      ['cluster.after.yaml', `${secret('aHVudGVyMg==')}---\n${service}---\n${deployment(4)}`],
    ]);

    await harness.page.getByTestId('pick-file-before').click();
    await harness.page.getByTestId('pick-file-after').click();
    await harness.page.getByTestId('compare-button').click();

    const view = harness.page.getByTestId('env-view');
    await expect(view).toBeVisible({ timeout: 20_000 });
    await expect(view).toHaveAttribute('data-kind', 'k8s');

    // Reordering three objects changed nothing; only the replica count moved.
    const strip = harness.page.getByTestId('summary-strip');
    await expect(strip).toContainText('＋0 added');
    await expect(strip).toContainText('－0 removed');
    await expect(strip).toContainText('～1 modified');
    await expect(view.locator('[data-envkey="Deployment/prod/api.spec.replicas"]')).toHaveAttribute(
      'data-state',
      'changed',
    );

    // The Secret's base64 was decoded, then masked: the row says both.
    await harness.page.getByRole('tab', { name: /^All/ }).click();
    const password = view.locator('[data-envkey="Secret/creds.data.password"]');
    await expect(password).toHaveAttribute('data-state', 'same');
    await expect(password).toContainText('base64');
    await expect(password).not.toContainText('hunter2');

    await harness.screenshot('env-k8s');

    expect(harness.errors, `errors:\n${harness.errors.join('\n')}`).toEqual([]);
  } finally {
    if (root !== null) await rm(root, { recursive: true, force: true });
    await harness.close();
  }
});
