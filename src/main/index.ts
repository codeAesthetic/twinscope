import { BrowserWindow, app } from 'electron';
import { killWorkerForTesting, shutdownEngineHost } from './engine-host';
import { closeHistory } from './history';
import { registerIpcHandlers } from './ipc';
import { applySecurityPolicy } from './security';
import { createMainWindow, isHeadlessTest } from './window';
import { handleCompareLink, registerProtocol, registerProtocolHandlers } from './protocol';
import { registerQuickShortcut, unregisterQuickShortcut } from './quick';
import { readPreferences } from './settings';

/**
 * Electron main process entry point.
 *
 * Boot order matters: sandbox is enabled before any WebContents can exist, and
 * the security policy is installed before the first window loads (plan §3.7).
 */
app.enableSandbox();

// The `twinscope://` scheme (v0.2.12). Registered before `whenReady` so a cold
// start with a link on the command line is already claimed by the time the
// handlers below look at argv.
registerProtocol();

let mainWindow: BrowserWindow | null = null;

// A second launch focuses the running app rather than starting a rival instance.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    // Never under test: a spec that relaunches on the same profile (history's
    // restart check) can overlap a still-closing instance, and focusing here
    // would pull the screen away from whoever is working.
    if (isHeadlessTest()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  void app.whenReady().then(() => {
    applySecurityPolicy();
    registerIpcHandlers();

    mainWindow = createMainWindow();
    mainWindow.on('closed', () => {
      mainWindow = null;
    });

    // After the window exists, deliberately: a startup link has to have somewhere
    // to land, and `registerProtocolHandlers` acts on one immediately.
    registerProtocolHandlers();

    // Test-only seam: lets the harness kill the engine worker mid-job and prove
    // the app survives it. Reached via Playwright's main-process evaluate, so it
    // is never exposed to the renderer.
    if (process.env['NODE_ENV'] === 'test') {
      (globalThis as Record<string, unknown>)['__twinscopeKillEngineHost'] = killWorkerForTesting;
      // v0.2.12: a deep link with the confirmation injected. A native modal cannot
      // be driven from Playwright, and the *point* of the feature is that both
      // answers to it behave correctly — so both are reachable from a spec.
      (globalThis as Record<string, unknown>)['__twinscopeOpenLink'] = (
        url: string,
        accept: boolean,
      ) => handleCompareLink(url, { confirm: () => Promise.resolve(accept) });
    }

    // The window is already hidden under test; on macOS the *app* still has to
    // step back, or every launch bounces the Dock and takes the keyboard away
    // from whatever the user is actually doing.
    if (isHeadlessTest()) app.dock?.hide();

    // Global Quick Compare (v0.2.14). Opt-in and default off: taking a global
    // combination from another application on first launch is hostile. The
    // registration can fail when someone else already owns it — `quick:state`
    // reports that so the UI can say so rather than the feature just not existing.
    if (readPreferences().globalShortcut) {
      const ok = registerQuickShortcut();
      if (!ok) {
        console.warn('[quick] the global shortcut is already taken by another application');
      }
    }

    // macOS: clicking the dock icon with no windows open reopens one.
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) mainWindow = createMainWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  // A busy worker must not outlive the app.
  app.on('before-quit', () => {
    shutdownEngineHost();
    closeHistory();
    // A global shortcut outliving the app would keep firing into nothing.
    unregisterQuickShortcut();
  });
}
