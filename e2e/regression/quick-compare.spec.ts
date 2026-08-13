import { expect, test } from '@playwright/test';
import { launchApp } from '../helpers/launch';
import { waitForReady } from '../helpers/seed';

/**
 * REGRESSION — v0.2.14: Global Quick Compare.
 *
 * The global shortcut itself cannot be exercised: it is an OS-level binding, and
 * Playwright's `keyboard.press` goes to a focused window rather than to the window
 * manager. So the *registration* is asserted through main (`globalShortcut.register`
 * is the same call the shortcut path makes) and everything downstream — the panel,
 * the collection, the handoff — is driven for real.
 *
 * The panel is a second `BrowserWindow`, so this spec deals in two pages.
 */

test('quick compare: the panel collects two inputs and hands them to the main window', async () => {
  const harness = await launchApp();

  try {
    await waitForReady(harness);

    // ---------- the panel opens on request, as the global shortcut opens it ----------
    await harness.page.evaluate(() => window.twinscope.quick.open());

    const panelPage = await harness.app.waitForEvent('window', { timeout: 20_000 });
    await panelPage.waitForLoadState('domcontentloaded');
    await expect(panelPage.getByTestId('quick-panel')).toBeVisible();

    // ---------- it is small, on top, and not in the taskbar ----------
    const geometry = await harness.app.evaluate(({ BrowserWindow }) => {
      const panel = BrowserWindow.getAllWindows().find((window) =>
        window.webContents.getURL().includes('#quick'),
      );
      if (panel === undefined) return null;
      const [width, height] = panel.getSize();
      return { width, height, onTop: panel.isAlwaysOnTop(), resizable: panel.isResizable() };
    });
    expect(geometry).toMatchObject({ width: 420, height: 320, onTop: true, resizable: false });

    // ---------- both slots start empty ----------
    await expect(panelPage.getByTestId('quick-slot-a')).toHaveAttribute('data-filled', 'false');
    await expect(panelPage.getByTestId('quick-compare')).toBeDisabled();

    // ---------- pasting fills the first empty slot, then the second ----------
    const setClipboard = (text: string): Promise<void> =>
      harness.app.evaluate(({ clipboard }, value: string) => clipboard.writeText(value), text);

    await setClipboard('value = 1\nshared line\n');
    await panelPage.getByTestId('quick-paste').click();
    await expect(panelPage.getByTestId('quick-slot-a')).toHaveAttribute('data-filled', 'true');

    await setClipboard('value = 2\nshared line\n');
    await panelPage.getByTestId('quick-paste').click();
    await expect(panelPage.getByTestId('quick-slot-b')).toHaveAttribute('data-filled', 'true');

    // ---------- with two inputs it says what will run ----------
    await expect(panelPage.getByTestId('quick-detected')).toContainText('Text diff');
    await expect(panelPage.getByTestId('quick-compare')).toBeEnabled();

    // ---------- and Compare hands off to the MAIN window rather than diffing here ----------
    await panelPage.getByTestId('quick-compare').click();
    await expect(harness.page.getByTestId('text-diff')).toBeVisible({ timeout: 20_000 });
    await expect(harness.page.getByTestId('summary-strip')).toContainText('～1 modified');

    // The panel emptied itself, ready for the next pair.
    await expect(panelPage.getByTestId('quick-slot-a')).toHaveAttribute('data-filled', 'false');

    expect(harness.errors, `errors:\n${harness.errors.join('\n')}`).toEqual([]);
  } finally {
    await harness.close();
  }
});

test('quick compare: the global shortcut is opt-in, and a failure to bind is reported', async () => {
  const harness = await launchApp();

  try {
    await waitForReady(harness);

    // ---------- off by default: taking a global combo unasked is hostile ----------
    const initial = await harness.page.evaluate(() => window.twinscope.quick.state());
    expect(initial.shortcutRegistered).toBe(false);
    expect(initial.shortcut).toContain('Shift+D');
    // The main window is not the panel.
    expect(initial.isQuick).toBe(false);

    const preferences = await harness.page.evaluate(() => window.twinscope.settings.read());
    expect(preferences.globalShortcut).toBe(false);
    expect(preferences.clipboardWatcher).toBe(false);

    // ---------- registering works, and reports itself through quick:state ----------
    const registered = await harness.app.evaluate(({ globalShortcut }) =>
      globalShortcut.register('CommandOrControl+Shift+D', () => undefined),
    );
    expect(registered).toBe(true);

    // ---------- and a combination someone else owns comes back FALSE, not silence ----------
    // The same call, made twice: the second is what a user with a conflicting app
    // experiences, and it has to be visible or the feature just does not exist.
    const again = await harness.app.evaluate(({ globalShortcut }) =>
      globalShortcut.isRegistered('CommandOrControl+Shift+D'),
    );
    expect(again).toBe(true);

    await harness.app.evaluate(({ globalShortcut }) => globalShortcut.unregisterAll());

    expect(harness.errors, `errors:\n${harness.errors.join('\n')}`).toEqual([]);
  } finally {
    await harness.close();
  }
});

test('quick compare: the clipboard watcher offers and never fills', async () => {
  const harness = await launchApp();

  try {
    await waitForReady(harness);

    // The signature is what the watcher polls: cheap, and it does NOT write an
    // image to a temp file the way a real read does.
    await harness.app.evaluate(({ clipboard }) => clipboard.writeText('watched content'));
    const signature = await harness.page.evaluate(() => window.twinscope.clipboard.signature());
    expect(signature.kind).toBe('text');
    expect(signature.size).toBe('watched content'.length);
    expect(signature.hint).toContain('watched');

    // ---------- with the watcher off, the panel says how to turn it on ----------
    await harness.page.evaluate(() => window.twinscope.quick.open());
    const panelPage = await harness.app.waitForEvent('window', { timeout: 20_000 });
    await panelPage.waitForLoadState('domcontentloaded');
    await expect(panelPage.getByTestId('quick-watch-hint')).toContainText('clipboard watcher');
    await expect(panelPage.getByTestId('quick-clipboard-offer')).toHaveCount(0);

    // ---------- with it on, a change is OFFERED — the slots stay empty ----------
    await harness.page.evaluate(() => window.twinscope.settings.write({ clipboardWatcher: true }));
    await panelPage.reload();
    await expect(panelPage.getByTestId('quick-panel')).toBeVisible();

    await harness.app.evaluate(({ clipboard }) => clipboard.writeText('something newly copied'));

    const offer = panelPage.getByTestId('quick-clipboard-offer');
    await expect(offer).toBeVisible({ timeout: 20_000 });
    await expect(offer).toContainText('Clipboard changed');
    // The point of the whole design: noticing is not the same as taking.
    await expect(panelPage.getByTestId('quick-slot-a')).toHaveAttribute('data-filled', 'false');

    // ---------- accepting it is one click, and then it fills ----------
    await offer.click();
    await expect(panelPage.getByTestId('quick-slot-a')).toHaveAttribute('data-filled', 'true');

    expect(harness.errors, `errors:\n${harness.errors.join('\n')}`).toEqual([]);
  } finally {
    await harness.close();
  }
});
