import { expect, test } from '@playwright/test';
import { launchApp } from './helpers/launch';

/**
 * The verification harness — deliberately NOT a growing E2E suite.
 *
 * It exists so a session can prove "the app boots and this works" instead of
 * claiming it. Extend the *harness* (helpers) freely; for a one-off check
 * during a feature, write a throwaway spec, run it, delete it.
 *
 * The security assertions stay permanently: they are cheap, and a regression
 * in any of them is a remote-code-execution bug rather than a UI bug.
 */
test('app boots, bridges to main, and stays locked down', async () => {
  const harness = await launchApp();

  try {
    await expect(harness.page.getByTestId('titlebar')).toBeVisible();
    await expect(harness.page.getByTestId('sidebar')).toBeVisible();
    expect(await harness.page.title()).toBe('DevDiff');

    // The preload bridge round-trips to main, and the UI shows it.
    const ping = await harness.page.evaluate(() => window.devdiff.ping());
    expect(ping.pong).toBe(true);
    await expect(harness.page.getByTestId('bridge-status')).toContainText('electron');

    // Context isolation: node must be unreachable from the page, and the
    // bridge must expose nothing beyond its declared surface.
    const leaks = await harness.page.evaluate(() => ({
      process: typeof (globalThis as Record<string, unknown>)['process'],
      require: typeof (globalThis as Record<string, unknown>)['require'],
      ipcRenderer: typeof (globalThis as Record<string, unknown>)['ipcRenderer'],
      bridge: Object.keys(window.devdiff),
    }));
    expect(leaks.process).toBe('undefined');
    expect(leaks.require).toBe('undefined');
    expect(leaks.ipcRenderer).toBe('undefined');
    expect(leaks.bridge.sort()).toEqual([
      'clipboard',
      'compare',
      'dialog',
      'input',
      'ping',
      'platform',
    ]);

    // New windows are denied.
    const opened = await harness.page.evaluate(() => window.open('https://example.com') !== null);
    expect(opened).toBe(false);

    // Navigating away is denied — the app stays on its own page.
    const before = harness.page.url();
    await harness.page.evaluate(() => {
      window.location.href = 'https://example.com';
    });
    await harness.page.waitForTimeout(1000);
    expect(harness.page.url()).toBe(before);

    await harness.screenshot(`boot-${harness.target}`);
    expect(harness.errors, `errors:\n${harness.errors.join('\n')}`).toEqual([]);

    console.log(`[verify] target=${harness.target} versions=${JSON.stringify(ping.versions)}`);
  } finally {
    await harness.close();
  }
});
