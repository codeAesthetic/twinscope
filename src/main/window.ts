import { BrowserWindow, app, screen } from 'electron';
import { join } from 'node:path';
import { readSettings, saveWindowState } from './settings';

/** Matches --bg in the design tokens: no white flash before the UI paints. */
const BACKGROUND = '#07090c';

const DEFAULT_SIZE = { width: 1440, height: 900 };
const MIN_SIZE = { width: 1080, height: 640 };

let saveTimer: NodeJS.Timeout | undefined;

/** The harness sets `NODE_ENV=test`; nothing else does. */
export function isHeadlessTest(): boolean {
  return process.env['NODE_ENV'] === 'test' && process.env['TWINSCOPE_SHOW_WINDOW'] !== '1';
}

/** Only restore a saved position if that display still exists. */
function isOnSomeDisplay(x: number, y: number): boolean {
  return screen.getAllDisplays().some(({ bounds }) => {
    return (
      x >= bounds.x && y >= bounds.y && x < bounds.x + bounds.width && y < bounds.y + bounds.height
    );
  });
}

function persist(window: BrowserWindow): void {
  if (window.isDestroyed()) return;
  const { width, height, x, y } = window.getNormalBounds();
  saveWindowState({ width, height, x, y, maximized: window.isMaximized() });
}

/** Resize and move fire continuously while dragging, so debounce the writes. */
function schedulePersist(window: BrowserWindow): void {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => persist(window), 400);
}

export function createMainWindow(): BrowserWindow {
  const saved = readSettings().window;
  const canRestorePosition =
    saved?.x !== undefined && saved.y !== undefined && isOnSomeDisplay(saved.x, saved.y);

  const window = new BrowserWindow({
    width: saved?.width ?? DEFAULT_SIZE.width,
    height: saved?.height ?? DEFAULT_SIZE.height,
    ...(canRestorePosition ? { x: saved.x, y: saved.y } : {}),
    minWidth: MIN_SIZE.width,
    minHeight: MIN_SIZE.height,
    backgroundColor: BACKGROUND,
    // The app draws its own titlebar (see the approved mockup).
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    ...(process.platform === 'win32'
      ? { titleBarOverlay: { color: BACKGROUND, symbolColor: '#98a2b3', height: 42 } }
      : {}),
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

  if (saved?.maximized) window.maximize();

  // Paint before showing, so the window never appears empty.
  //
  // Under test it is never shown at all: the suite is driven by Playwright, not
  // watched, and a run that throws twenty windows at the screen cannot be run
  // while working. Chromium still lays the page out and still paints it
  // (`paintWhenInitiallyHidden` defaults on), so measurement, `ResizeObserver`
  // and `page.screenshot` all keep telling the truth — which is the only reason
  // this is allowed to differ from production.
  window.once('ready-to-show', () => {
    if (!isHeadlessTest()) window.show();
  });

  window.on('resize', () => schedulePersist(window));
  window.on('move', () => schedulePersist(window));
  window.on('close', () => {
    clearTimeout(saveTimer);
    persist(window);
  });

  const devServerUrl = process.env['ELECTRON_RENDERER_URL'];
  if (devServerUrl && !app.isPackaged) {
    void window.loadURL(devServerUrl);
    window.webContents.openDevTools({ mode: 'detach' });
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'));
  }

  return window;
}
