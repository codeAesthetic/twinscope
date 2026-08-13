import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, test } from '@playwright/test';
import { launchApp, type Harness } from '../helpers/launch';

/**
 * REGRESSION — v0.2.6: the shared normalisation rules.
 *
 * The feature's whole claim is that it is *one* pipeline in *every* engine, so the
 * assertion that matters is the same rule suppressing a difference in more than one
 * of them. A version wired into only the JSON core would pass a single-engine spec.
 */

async function stage(harness: Harness, files: Array<[string, string]>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'twinscope-norm-'));
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

async function open(harness: Harness): Promise<void> {
  await harness.page.getByTestId('pick-file-before').click();
  await harness.page.getByTestId('pick-file-after').click();
  await harness.page.getByTestId('compare-button').click();
}

test('normalisation: one rule, and the counts come back from the engine', async () => {
  const harness = await launchApp();
  let root: string | null = null;

  try {
    // Two runs of the same generator: the ids and the timestamps are new, the data
    // is not. This is the case the whole feature exists for.
    root = await stage(harness, [
      [
        'run-1.json',
        JSON.stringify(
          {
            requestId: '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
            generatedAt: '2026-01-01T10:00:00Z',
            user: { name: 'Ada', city: 'London' },
          },
          null,
          2,
        ),
      ],
      [
        'run-2.json',
        JSON.stringify(
          {
            requestId: '8a6b1c22-1111-4444-8888-0305e82c3301',
            generatedAt: '2026-08-13T22:31:04Z',
            user: { name: 'Ada', city: 'London' },
          },
          null,
          2,
        ),
      ],
    ]);

    await open(harness);
    await expect(harness.page.getByTestId('json-tree')).toBeVisible({ timeout: 20_000 });

    const strip = harness.page.getByTestId('summary-strip');
    await expect(strip).toContainText('～2 modified');

    // ---------- the panel is there, and every rule starts off ----------
    const panel = harness.page.getByTestId('normalize-controls');
    await expect(panel).toBeVisible();
    for (const rule of ['norm-timestamps', 'norm-uuids', 'norm-hashes']) {
      await expect(panel.getByTestId(rule).getByRole('switch')).toHaveAttribute(
        'aria-checked',
        'false',
      );
    }

    // ---------- turning one on re-runs the engine, so the COUNTS change ----------
    await panel.getByTestId('norm-uuids').getByRole('switch').click();
    await expect(strip).toContainText('～1 modified', { timeout: 20_000 });
    await expect(strip).toContainText('1 suppressed');

    // ---------- and the rule that fired is named, not just counted (Rule 3) ----------
    await harness.page.getByRole('tab', { name: 'Tree' }).click();
    await expect(harness.page.getByTestId('json-explain')).toContainText('1 of 2 differences');

    // ---------- the second rule takes it to zero ----------
    await panel.getByTestId('norm-timestamps').getByRole('switch').click();
    await expect(strip).toContainText('～0 modified', { timeout: 20_000 });
    await expect(strip).toContainText('2 suppressed');

    await harness.screenshot('normalize-json');

    // ---------- and switching a rule back off restores the difference ----------
    await panel.getByTestId('norm-uuids').getByRole('switch').click();
    await expect(strip).toContainText('～1 modified', { timeout: 20_000 });

    expect(harness.errors, `errors:\n${harness.errors.join('\n')}`).toEqual([]);
  } finally {
    await harness.close();
    if (root !== null) await rm(root, { recursive: true, force: true });
  }
});

test('normalisation: the same rules work in the text engine', async () => {
  const harness = await launchApp();
  let root: string | null = null;

  try {
    root = await stage(harness, [
      [
        'log-1.txt',
        'start 2026-01-01T10:00:00Z\nrequest 3f2504e0-4f89-11d3-9a0c-0305e82c3301\ndone\n',
      ],
      [
        'log-2.txt',
        'start 2026-08-13T22:31:04Z\nrequest 8a6b1c22-1111-4444-8888-0305e82c3301\ndone\n',
      ],
    ]);

    await open(harness);
    await expect(harness.page.getByTestId('text-diff')).toBeVisible({ timeout: 20_000 });

    const strip = harness.page.getByTestId('summary-strip');
    await expect(strip).toContainText('～2 modified');

    const panel = harness.page.getByTestId('normalize-controls');
    await panel.getByTestId('norm-timestamps').getByRole('switch').click();
    await expect(strip).toContainText('～1 modified', { timeout: 20_000 });

    await panel.getByTestId('norm-uuids').getByRole('switch').click();
    await expect(strip).toContainText('～0 modified', { timeout: 20_000 });
    // Normalisation changes what is *compared*, never what is *displayed*: both
    // files' text is still on screen, each on its own side.
    const diff = harness.page.getByTestId('text-diff');
    await expect(diff).toContainText('2026-01-01T10:00:00Z');
    await expect(diff).toContainText('2026-08-13T22:31:04Z');
    await expect(diff).toContainText('3f2504e0-4f89-11d3-9a0c-0305e82c3301');
    await expect(diff).toContainText('8a6b1c22-1111-4444-8888-0305e82c3301');

    await harness.screenshot('normalize-text');

    expect(harness.errors, `errors:\n${harness.errors.join('\n')}`).toEqual([]);
  } finally {
    await harness.close();
    if (root !== null) await rm(root, { recursive: true, force: true });
  }
});

test('normalisation: a custom rule works in the table engine', async () => {
  const harness = await launchApp();
  let root: string | null = null;

  try {
    root = await stage(harness, [
      ['a.csv', 'id,name,city\nreq_1,Ada,London\nreq_2,Bob,Leeds\n'],
      ['b.csv', 'id,name,city\nreq_88,Ada,London\nreq_99,Bob,Leeds\n'],
    ]);

    await open(harness);
    await expect(harness.page.getByTestId('csv-table')).toBeVisible({ timeout: 20_000 });
    await expect(harness.page.getByTestId('summary-strip')).toContainText('～2 modified');

    // A custom pattern, committed with Enter — not on every keystroke, since each
    // commit re-runs the engine.
    const input = harness.page.getByTestId('norm-custom-input');
    await input.fill('req_\\d+');
    await input.press('Enter');

    await expect(harness.page.getByTestId('norm-rule-0')).toHaveText('req_\\d+', {
      timeout: 20_000,
    });
    await expect(harness.page.getByTestId('summary-strip')).toContainText('～0 modified');
    await expect(harness.page.getByTestId('summary-strip')).toContainText('2 identical');

    // ---------- removing it brings the differences back ----------
    await harness.page.getByTestId('norm-remove-0').click();
    await expect(harness.page.getByTestId('summary-strip')).toContainText('～2 modified', {
      timeout: 20_000,
    });

    expect(harness.errors, `errors:\n${harness.errors.join('\n')}`).toEqual([]);
  } finally {
    await harness.close();
    if (root !== null) await rm(root, { recursive: true, force: true });
  }
});

test('normalisation: a tolerance is not a mask, and an invalid rule says so', async () => {
  const harness = await launchApp();
  let root: string | null = null;

  try {
    root = await stage(harness, [
      ['a.json', JSON.stringify({ at: '2026-08-13T10:00:00Z', n: 1.001 })],
      ['b.json', JSON.stringify({ at: '2026-08-13T10:00:30Z', n: 1.002 })],
    ]);

    await open(harness);
    await expect(harness.page.getByTestId('json-tree')).toBeVisible({ timeout: 20_000 });

    const strip = harness.page.getByTestId('summary-strip');
    await expect(strip).toContainText('～2 modified');

    // 30 seconds apart, so a minute of tolerance covers it.
    await harness.page.getByTestId('norm-timestamp-tolerance').fill('60000');
    await harness.page.getByTestId('norm-timestamp-tolerance').blur();
    await expect(strip).toContainText('～1 modified', { timeout: 20_000 });

    await harness.page.getByTestId('norm-number-tolerance').fill('0.01');
    await harness.page.getByTestId('norm-number-tolerance').blur();
    await expect(strip).toContainText('～0 modified', { timeout: 20_000 });

    // ---------- an uncompilable pattern is reported, not fatal ----------
    const input = harness.page.getByTestId('norm-custom-input');
    await input.fill('([unclosed');
    await input.press('Enter');
    await expect(harness.page.getByTestId('norm-rule-0')).toBeVisible({ timeout: 20_000 });
    // The comparison still ran, and still says zero.
    await expect(strip).toContainText('～0 modified');

    expect(harness.errors, `errors:\n${harness.errors.join('\n')}`).toEqual([]);
  } finally {
    await harness.close();
    if (root !== null) await rm(root, { recursive: true, force: true });
  }
});
