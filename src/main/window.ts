import { BrowserWindow, app } from 'electron';
import { join } from 'node:path';

/** Matches --bg in the design tokens: no white flash before the UI paints. */
const BACKGROUND = '#07090c';

export function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 640,
    backgroundColor: BACKGROUND,
    // The app draws its own titlebar (see the approved mockup), so the native
    // one gets out of the way.
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // The four that matter (plan §3.7).
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });

  // Paint before showing, so the window never appears empty.
  window.once('ready-to-show', () => window.show());

  const devServerUrl = process.env['ELECTRON_RENDERER_URL'];
  if (devServerUrl && !app.isPackaged) {
    void window.loadURL(devServerUrl);
    window.webContents.openDevTools({ mode: 'detach' });
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'));
  }

  return window;
}
