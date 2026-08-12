import { BrowserWindow, app } from 'electron';
import { killWorkerForTesting, shutdownEngineHost } from './engine-host';
import { closeHistory } from './history';
import { registerIpcHandlers } from './ipc';
import { applySecurityPolicy } from './security';
import { createMainWindow } from './window';

/**
 * Electron main process entry point.
 *
 * Boot order matters: sandbox is enabled before any WebContents can exist, and
 * the security policy is installed before the first window loads (plan §3.7).
 */
app.enableSandbox();

let mainWindow: BrowserWindow | null = null;

// A second launch focuses the running app rather than starting a rival instance.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
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

    // Test-only seam: lets the harness kill the engine worker mid-job and prove
    // the app survives it. Reached via Playwright's main-process evaluate, so it
    // is never exposed to the renderer.
    if (process.env['NODE_ENV'] === 'test') {
      (globalThis as Record<string, unknown>)['__devdiffKillEngineHost'] = killWorkerForTesting;
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
  });
}
