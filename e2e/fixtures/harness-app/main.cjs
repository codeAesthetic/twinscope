/**
 * Minimal Electron app whose only purpose is proving the Playwright harness
 * works. Not the product — `src/main` is (from SETUP-2 onward).
 *
 * CommonJS on purpose: the workspace is ESM, and a .cjs fixture avoids needing
 * a build step to launch.
 */
const { app, BrowserWindow } = require('electron');
const path = require('node:path');

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 900,
    height: 600,
    backgroundColor: '#07090c',
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  win.loadFile(path.join(__dirname, 'index.html'));
});

app.on('window-all-closed', () => {
  app.quit();
});
