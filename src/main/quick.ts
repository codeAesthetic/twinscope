import { BrowserWindow, app, globalShortcut, screen } from 'electron';
import { join } from 'node:path';
import { isHeadlessTest } from './window';
import type { InputPayload } from '../shared/channels';

/**
 * Global Quick Compare (v0.2.14, MD §35).
 *
 * A global shortcut and a small always-on-top window, for the case the app is not
 * open and the two things to compare are already in hand.
 *
 * **It hands off rather than comparing in place.** A 420×320 always-on-top panel is
 * the wrong place to read a diff: the window collects two inputs and then opens the
 * main window with them. That also means no second copy of the workspace — the quick
 * window is the same renderer at `#quick`, the route mechanism `#gallery` already
 * uses.
 */

/** ⌘⇧D / Ctrl+Shift+D. Fixed rather than configurable: one binding, documented. */
export const QUICK_SHORTCUT = 'CommandOrControl+Shift+D';

const SIZE = { width: 420, height: 320 };
const BACKGROUND = '#07090c';

let quickWindow: BrowserWindow | null = null;
let registered = false;

/** Top-right of the display the cursor is on — near the hand, off the work. */
function positionFor(): { x: number; y: number } {
  const cursor = screen.getCursorScreenPoint();
  const { workArea } = screen.getDisplayNearestPoint(cursor);
  return {
    x: Math.round(workArea.x + workArea.width - SIZE.width - 24),
    y: Math.round(workArea.y + 24),
  };
}

function createQuickWindow(): BrowserWindow {
  const window = new BrowserWindow({
    ...SIZE,
    ...positionFor(),
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    backgroundColor: BACKGROUND,
    // Always on top of *everything*, including full-screen apps on macOS, which is
    // the whole point of a panel you summon over whatever you were doing.
    alwaysOnTop: true,
    skipTaskbar: true,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });

  window.setAlwaysOnTop(true, 'floating');
  if (process.platform === 'darwin') window.setVisibleOnAllWorkspaces(true);

  // Dismissing on blur is what makes it feel like a panel rather than a window.
  // Not under test: Playwright's own focus changes would close it mid-assertion.
  if (!isHeadlessTest()) {
    window.on('blur', () => {
      if (!window.isDestroyed()) window.hide();
    });
  }

  window.on('closed', () => {
    quickWindow = null;
  });

  const devServerUrl = process.env['ELECTRON_RENDERER_URL'];
  if (devServerUrl && !app.isPackaged) {
    void window.loadURL(`${devServerUrl}#quick`);
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'quick' });
  }

  return window;
}

/** Opens the panel, creating it the first time. Returns it so tests can address it. */
export function showQuickWindow(): BrowserWindow {
  if (quickWindow === null || quickWindow.isDestroyed()) {
    quickWindow = createQuickWindow();
  }

  const window = quickWindow;
  // Re-position on every summon: the cursor may be on a different display now.
  window.setBounds({ ...positionFor(), ...SIZE });
  if (!isHeadlessTest()) {
    window.show();
    window.focus();
  }
  return window;
}

export function hideQuickWindow(): void {
  if (quickWindow !== null && !quickWindow.isDestroyed()) quickWindow.hide();
}

export function isQuickWindow(window: BrowserWindow | null): boolean {
  return window !== null && quickWindow !== null && window.id === quickWindow.id;
}

/**
 * Registers the global shortcut.
 *
 * Returns false when another application already owns the combination — which is
 * ordinary, not exceptional, and has to reach the user. A silent failure here means
 * a feature that simply does not exist, with nothing to explain why.
 */
export function registerQuickShortcut(): boolean {
  if (registered) return true;
  registered = globalShortcut.register(QUICK_SHORTCUT, () => {
    showQuickWindow();
  });
  return registered;
}

export function unregisterQuickShortcut(): void {
  if (!registered) return;
  globalShortcut.unregister(QUICK_SHORTCUT);
  registered = false;
}

export function isQuickShortcutRegistered(): boolean {
  return registered && globalShortcut.isRegistered(QUICK_SHORTCUT);
}

/**
 * Hands two inputs to the main window and brings it forward.
 *
 * The panel closes first so the handoff reads as one movement rather than two
 * windows fighting for focus.
 */
export function handoffToMain(
  main: BrowserWindow | null,
  inputs: { a: InputPayload; b: InputPayload },
): boolean {
  hideQuickWindow();
  if (main === null || main.isDestroyed()) return false;

  main.webContents.send('quick:inputs', inputs);
  if (!isHeadlessTest()) {
    if (main.isMinimized()) main.restore();
    main.show();
    main.focus();
  }
  return true;
}
