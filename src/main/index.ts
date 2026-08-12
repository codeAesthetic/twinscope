import { BrowserWindow, app } from 'electron';
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

    // macOS: clicking the dock icon with no windows open reopens one.
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) mainWindow = createMainWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
