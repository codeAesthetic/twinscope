import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, test } from '@playwright/test';
import { launchApp, type Harness } from '../helpers/launch';
import { pasteInput } from '../helpers/seed';

/**
 * REGRESSION — v0.2.7: the Diff Radar.
 *
 * The assertion that matters is not that a polygon renders. It is that an axis the
 * engine cannot measure is drawn **hollow and named**, in two different engines
 * whose blind spots are different — because plotting an unmeasured axis at zero is
 * the exact dishonesty the feature was told to avoid.
 */

async function stage(harness: Harness, files: Array<[string, string]>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'twinscope-radar-'));
  const paths: string[] = [];
  for (const [name, content] of files) {
    const { mkdir } = await import('node:fs/promises');
    const directory = join(root, `side-${paths.length}`);
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

test('radar: the text engine plots two axes and admits to four it cannot measure', async () => {
  const harness = await launchApp();

  try {
    await pasteInput(harness, 'one\nvalue = 1\nthree\n', 'before');
    await pasteInput(harness, 'one\nvalue = 2\nthree\nfour\n', 'after');
    await harness.page.getByTestId('compare-button').click();
    await expect(harness.page.getByTestId('text-diff')).toBeVisible({ timeout: 20_000 });

    // ---------- collapsed by default: most comparisons are read by their numbers ----------
    const toggle = harness.page.getByTestId('radar-toggle');
    await expect(toggle).toBeVisible();
    await expect(harness.page.getByTestId('diff-radar')).toHaveCount(0);

    await toggle.click();
    const radar = harness.page.getByTestId('diff-radar');
    await expect(radar).toBeVisible();

    // ---------- six axes are always drawn, but only measured ones are filled ----------
    for (const axis of [
      'structure',
      'content',
      'visual',
      'metadata',
      'dependencies',
      'performance',
    ]) {
      await expect(radar.getByTestId(`radar-dot-${axis}`)).toHaveCount(1);
    }
    await expect(radar.getByTestId('radar-dot-structure')).toHaveAttribute('data-measured', 'true');
    await expect(radar.getByTestId('radar-dot-content')).toHaveAttribute('data-measured', 'true');
    // A line diff knows nothing about pixels, licences, packages or weight.
    for (const axis of ['visual', 'metadata', 'dependencies', 'performance']) {
      await expect(radar.getByTestId(`radar-dot-${axis}`)).toHaveAttribute(
        'data-measured',
        'false',
      );
    }

    // ---------- and it says so in words, not only in the drawing ----------
    const missing = harness.page.getByTestId('radar-missing');
    await expect(missing).toContainText('Not measured by this comparison');
    await expect(missing).toContainText('Visual');
    await expect(missing).toContainText('Deps');

    // ---------- the legend keys only exist for measured axes ----------
    await expect(radar.getByTestId('radar-key-structure')).toBeVisible();
    await expect(radar.getByTestId('radar-key-visual')).toHaveCount(0);

    // ---------- selecting an axis says what it means ----------
    await radar.getByTestId('radar-key-content').click();
    await expect(harness.page.getByTestId('radar-meaning')).toContainText('changed in place');
    await radar.getByTestId('radar-key-content').click();
    await expect(harness.page.getByTestId('radar-meaning')).toHaveCount(0);

    await harness.screenshot('radar-text');

    // ---------- and it collapses again ----------
    await toggle.click();
    await expect(harness.page.getByTestId('diff-radar')).toHaveCount(0);

    expect(harness.errors, `errors:\n${harness.errors.join('\n')}`).toEqual([]);
  } finally {
    await harness.close();
  }
});

test('radar: the deps engine fills the axis the radar was waiting for', async () => {
  const harness = await launchApp();
  let root: string | null = null;

  try {
    root = await stage(harness, [
      [
        'package.json',
        JSON.stringify({ dependencies: { react: '^19.0.0', lodash: '^4.17.0', gone: '^1.0.0' } }),
      ],
      [
        'package.json',
        JSON.stringify({ dependencies: { react: '^19.0.0', lodash: '^5.0.0', fresh: '^1.0.0' } }),
      ],
    ]);

    await harness.page.getByTestId('pick-file-before').click();
    await harness.page.getByTestId('pick-file-after').click();
    await harness.page.getByTestId('compare-button').click();
    await expect(harness.page.getByTestId('deps-view')).toBeVisible({ timeout: 20_000 });

    await harness.page.getByTestId('radar-toggle').click();
    const radar = harness.page.getByTestId('diff-radar');

    // This is why v0.2.10 was built first: without it the axis could never be real.
    await expect(radar.getByTestId('radar-dot-dependencies')).toHaveAttribute(
      'data-measured',
      'true',
    );
    await expect(radar.getByTestId('radar-key-dependencies')).toBeVisible();

    // A *manifest* pair resolves nothing, so licences and weight stay unknown —
    // a different blind spot from the text engine's, which is the point.
    await expect(radar.getByTestId('radar-dot-metadata')).toHaveAttribute('data-measured', 'false');
    await expect(harness.page.getByTestId('radar-missing')).toContainText('Weight');

    await harness.screenshot('radar-deps');

    expect(harness.errors, `errors:\n${harness.errors.join('\n')}`).toEqual([]);
  } finally {
    await harness.close();
    if (root !== null) await rm(root, { recursive: true, force: true });
  }
});

test('radar: identical inputs offer no radar at all', async () => {
  const harness = await launchApp();

  try {
    await pasteInput(harness, 'same\ncontent\n', 'before');
    await pasteInput(harness, 'same\ncontent\n', 'after');
    await harness.page.getByTestId('compare-button').click();
    await expect(harness.page.getByTestId('summary-strip')).toBeVisible({ timeout: 20_000 });

    // Six zeroes would claim six measurements were taken. Nothing was measured,
    // because the engine short-circuited before comparing anything.
    await expect(harness.page.getByTestId('radar-toggle')).toHaveCount(0);

    expect(harness.errors, `errors:\n${harness.errors.join('\n')}`).toEqual([]);
  } finally {
    await harness.close();
  }
});
