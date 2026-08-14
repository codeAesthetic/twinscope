import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, test } from '@playwright/test';
import { launchApp, type Harness } from '../helpers/launch';

/**
 * REGRESSION — MVP-1: the comparison job lifecycle.
 *
 * Every engine from MVP-4 onward rides this path, so a break here breaks the
 * whole product. Driven by the demo engine, which reports progress and nothing
 * else — the point is the plumbing, not the diff. It is slow and cancellable on
 * purpose, which is exactly what a real engine on small inputs is not.
 *
 * Its button is **development-only** now, gated on `PingResult.isDev` — false in
 * a packaged build, so a user never sees it. Beside it sits the user-facing
 * "Load sample comparison", which runs the real text engine, because a demo
 * whose own footnote admits no comparison happened is not a demo. The harness
 * always sets `NODE_ENV=test`, so `isDev` is true here and the button is present.
 */
async function runDemo(harness: Harness): Promise<void> {
  await harness.page.getByTestId('demo-button').click();
}

test('job lifecycle: progress, completion, cancellation, crash recovery', async () => {
  const harness = await launchApp();

  try {
    // ---------- runs, reports progress, completes ----------
    await runDemo(harness);

    // Navigation is immediate so progress is visible while the engine works.
    await expect(harness.page.getByTestId('screen-workspace')).toBeVisible();
    await expect(harness.page.getByTestId('job-progress')).toBeVisible();
    await expect(harness.page.getByTestId('workspace-toolbar')).toContainText(
      'Demo (pipeline test)',
    );

    // A bar stuck at 0 would still "be visible" — assert it actually moves.
    await expect
      .poll(async () => {
        const label = await harness.page.getByTestId('progress-label').textContent();
        return Number.parseInt(label ?? '0', 10);
      })
      .toBeGreaterThan(0);

    await expect(harness.page.getByTestId('demo-result-view')).toBeVisible({ timeout: 20_000 });
    await expect(harness.page.getByTestId('summary-strip')).toContainText('11 changes');
    await expect(harness.page.getByTestId('normalization-notes')).toContainText('Demo engine');

    // ---------- the chassis: engine view, toolbar slot, change nav, status ----------
    // The engine's own control was portalled into the chassis toolbar.
    await expect(
      harness.page.getByTestId('workspace-toolbar').getByRole('button', { name: /Show notes/ }),
    ).toBeVisible();

    // Status bar publishes the engine and timing, while keeping the privacy claim.
    await expect(harness.page.getByTestId('statusbar')).toContainText('Local only');
    await expect(harness.page.getByTestId('status-detail')).toContainText('demo engine');
    await expect(harness.page.getByTestId('status-right')).toContainText('Compared in');

    // Titlebar names the comparison.
    await expect(harness.page.getByTestId('titlebar-title')).toContainText('demo-before.txt');

    // Change navigation: the strip, the view and ⌥↓ share one index.
    await expect(harness.page.getByTestId('change-position')).toHaveText('– / 11');
    await harness.page.getByRole('button', { name: 'Next change' }).click();
    await expect(harness.page.getByTestId('change-position')).toHaveText('1 / 11');
    await expect(harness.page.getByTestId('demo-change-0')).toHaveAttribute('aria-current', 'true');

    await harness.page.keyboard.press('Alt+ArrowDown');
    await expect(harness.page.getByTestId('change-position')).toHaveText('2 / 11');
    await expect(harness.page.getByTestId('demo-change-1')).toHaveAttribute('aria-current', 'true');

    // Stepping back past the first wraps to the last, rather than sticking.
    await harness.page.keyboard.press('Alt+ArrowUp');
    await harness.page.keyboard.press('Alt+ArrowUp');
    await expect(harness.page.getByTestId('change-position')).toHaveText('11 / 11');

    // The engine's toggle drives its own view, not the chassis.
    await harness.page.getByRole('button', { name: /Show notes/ }).click();
    await expect(harness.page.getByTestId('normalization-notes')).toHaveCount(0);

    // ---------- cancellation ----------
    // "New comparison" must clear the inputs — the empty-state bar only renders
    // when both sides are null, so this is what proves it.
    await harness.page.getByTestId('back-button').click();
    await expect(harness.page.getByTestId('sample-button')).toBeVisible();

    await runDemo(harness);
    await expect(harness.page.getByTestId('job-progress')).toBeVisible();
    await harness.page.getByTestId('cancel-button').click();
    await expect(harness.page.getByTestId('job-error')).toContainText('Comparison cancelled');

    // ---------- a worker crash is survivable ----------
    await harness.page.getByTestId('back-button').click();
    await runDemo(harness);
    await expect(harness.page.getByTestId('job-progress')).toBeVisible();

    // Killed from the main process, so the renderer never gets this power.
    const killed = await harness.app.evaluate(() => {
      const kill = (globalThis as Record<string, unknown>)['__twinscopeKillEngineHost'];
      return typeof kill === 'function' ? (kill as () => boolean)() : false;
    });
    expect(killed, 'test seam should exist under NODE_ENV=test').toBe(true);

    await expect(harness.page.getByTestId('job-error')).toContainText('stopped unexpectedly', {
      timeout: 10_000,
    });

    // A real failure offers copyable details; a cancellation does not.
    await expect(harness.page.getByTestId('copy-details')).toBeVisible();
    await harness.page.getByTestId('copy-details').click();
    await expect(harness.page.getByTestId('copy-details')).toContainText('Copied');
    const copied = await harness.app.evaluate(({ clipboard }) => clipboard.readText());
    expect(copied).toContain('stopped unexpectedly');
    expect(copied).toContain('engine: Demo');

    // ...and the next job succeeds on a freshly spawned worker.
    await harness.page.getByTestId('back-button').click();
    await runDemo(harness);
    await expect(harness.page.getByTestId('demo-result-view')).toBeVisible({ timeout: 20_000 });

    expect(harness.errors, `errors:\n${harness.errors.join('\n')}`).toEqual([]);
  } finally {
    await harness.close();
  }
});

test('job lifecycle: an engine this host cannot run declines, and does not call it a failure', async () => {
  /*
   * The error panel has THREE states, and only one of them is a failure. The
   * visual engine (v0.3.5) is command-line-only by design — it needs to list a
   * directory *and* decode images, and no single process in the app can do both
   * — so asking for it here is answered, not broken. It shipped painted in
   * --del under "Comparison failed", which is what `visual-regression.png`, the
   * one picture on /docs/engines/visual, published to every reader.
   *
   * No fixture can make this pass by accident: no pair of folders exists that
   * would let this engine run in the app, which is exactly why the state needs
   * to read as a limit rather than as a casualty.
   */
  const files = await mkdtemp(join(tmpdir(), 'twinscope-visual-'));
  const harness = await launchApp();

  try {
    const before = join(files, 'baseline');
    const after = join(files, 'current');
    for (const dir of [before, after]) {
      await mkdir(dir, { recursive: true });
      // Never decoded — the refusal happens before anything is read.
      await writeFile(join(dir, 'dashboard.png'), 'not really a png');
    }

    await harness.app.evaluate(
      ({ dialog }, paths: string[]) => {
        let call = 0;
        dialog.showOpenDialog = () =>
          Promise.resolve({ canceled: false, filePaths: [paths[call++] ?? paths[0]!] });
      },
      [before, after],
    );

    await harness.page.getByTestId('pick-folder-before').click();
    await harness.page.getByTestId('pick-folder-after').click();

    // Detection will not choose it — two folders of screenshots and two folders
    // of source code look the same from outside — so it is asked for by name.
    await harness.page.getByTestId('engine-select').selectOption('visual');
    await harness.page.getByTestId('compare-button').click();

    const panel = harness.page.getByTestId('job-error');
    await expect(panel).toBeVisible({ timeout: 30_000 });
    await expect(panel).toContainText('Not available in the app');
    await expect(panel).not.toContainText('Comparison failed');

    // Neutral, not the failure colour. Asserted on the computed value rather
    // than on the token name, since that is what a reader actually sees.
    const heading = panel.locator('p').first();
    const [colour, failColour] = await heading.evaluate((element) => {
      const style = getComputedStyle(element);
      const root = getComputedStyle(document.documentElement);
      return [style.color, root.getPropertyValue('--del').trim()];
    });
    expect(colour).not.toBe(failColour);

    // The command is a command: its own element, in mono, typed as typed.
    await expect(harness.page.getByTestId('error-command')).toHaveText(
      'twinscope baseline/ current/ --engine visual',
    );

    // Nothing to report, so nothing offers to collect a report...
    await expect(harness.page.getByTestId('copy-details')).toHaveCount(0);
    // ...but the way out stands, and it works: the folder engine can still say
    // something about these two directories.
    await harness.page.getByTestId('error-fallback').click();
    await expect(harness.page.getByTestId('folder-tree')).toBeVisible({ timeout: 20_000 });

    expect(harness.errors, `errors:\n${harness.errors.join('\n')}`).toEqual([]);
  } finally {
    await harness.close();
    await rm(files, { recursive: true, force: true });
  }
});
