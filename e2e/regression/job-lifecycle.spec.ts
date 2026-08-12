import { expect, test } from '@playwright/test';
import { launchApp } from '../helpers/launch';

/**
 * REGRESSION — MVP-1: the comparison job lifecycle.
 *
 * Every engine from MVP-4 onward rides this path, so a break here breaks the
 * whole product. Driven by the demo engine, which reports progress and nothing
 * else — the point is the plumbing, not the diff.
 */
test('job lifecycle: progress, completion, cancellation, crash recovery', async () => {
  const harness = await launchApp();

  try {
    // ---------- runs, reports progress, completes ----------
    await harness.page.getByTestId('demo-button').click();

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

    await expect(harness.page.getByTestId('job-done')).toBeVisible({ timeout: 20_000 });
    await expect(harness.page.getByTestId('summary-strip')).toContainText('11 changes');
    await expect(harness.page.getByTestId('normalization-notes')).toContainText('Demo engine');

    // ---------- cancellation ----------
    // "New comparison" must clear the inputs, or the demo button never returns.
    await harness.page.getByTestId('back-button').click();
    await expect(harness.page.getByTestId('demo-button')).toBeVisible();

    await harness.page.getByTestId('demo-button').click();
    await expect(harness.page.getByTestId('job-progress')).toBeVisible();
    await harness.page.getByTestId('cancel-button').click();
    await expect(harness.page.getByTestId('job-error')).toContainText('Comparison cancelled');

    // ---------- a worker crash is survivable ----------
    await harness.page.getByTestId('back-button').click();
    await harness.page.getByTestId('demo-button').click();
    await expect(harness.page.getByTestId('job-progress')).toBeVisible();

    // Killed from the main process, so the renderer never gets this power.
    const killed = await harness.app.evaluate(() => {
      const kill = (globalThis as Record<string, unknown>)['__devdiffKillEngineHost'];
      return typeof kill === 'function' ? (kill as () => boolean)() : false;
    });
    expect(killed, 'test seam should exist under NODE_ENV=test').toBe(true);

    await expect(harness.page.getByTestId('job-error')).toContainText('stopped unexpectedly', {
      timeout: 10_000,
    });

    // ...and the next job succeeds on a freshly spawned worker.
    await harness.page.getByTestId('back-button').click();
    await harness.page.getByTestId('demo-button').click();
    await expect(harness.page.getByTestId('job-done')).toBeVisible({ timeout: 20_000 });

    expect(harness.errors, `errors:\n${harness.errors.join('\n')}`).toEqual([]);
  } finally {
    await harness.close();
  }
});
