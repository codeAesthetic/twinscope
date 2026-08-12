import { app, session, type WebContents } from 'electron';

/**
 * Electron hardening (plan §3.7). This is the file to re-read before every
 * release — a regression here is a remote-code-execution bug, not a UI bug.
 *
 * The window-level flags (contextIsolation / sandbox / nodeIntegration) live in
 * `window.ts` where the BrowserWindow is constructed.
 */

const isDev = !app.isPackaged;

/**
 * In dev the renderer is served over http by Vite and needs its websocket for
 * HMR plus inline scripts for React Refresh. In production it is a file:// page
 * that needs neither.
 */
function contentSecurityPolicy(): string {
  const common = [
    "default-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ];

  return isDev
    ? [
        ...common,
        "script-src 'self' 'unsafe-inline'",
        "connect-src 'self' ws: http://localhost:*",
      ].join('; ')
    : [...common, "script-src 'self'", "connect-src 'self'"].join('; ');
}

/** Origins the app is ever allowed to navigate to. Everything else is denied. */
function isAllowedNavigation(target: string): boolean {
  const devServer = process.env['ELECTRON_RENDERER_URL'];

  if (devServer && target.startsWith(devServer)) return true;
  if (target.startsWith('file://')) return true;

  return false;
}

function hardenWebContents(contents: WebContents): void {
  // Nothing opens a new window — not target=_blank, not window.open.
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));

  // The renderer may never navigate away from the app.
  contents.on('will-navigate', (event, url) => {
    if (!isAllowedNavigation(url)) {
      event.preventDefault();
      console.warn(`[security] blocked navigation to ${url}`);
    }
  });

  // No <webview> embedding, ever.
  contents.on('will-attach-webview', (event) => {
    event.preventDefault();
    console.warn('[security] blocked <webview> attach');
  });

  // Deny every permission request: nothing in DevDiff needs camera, mic,
  // geolocation, notifications or clipboard-read escalation.
  contents.session.setPermissionRequestHandler((_wc, permission, callback) => {
    console.warn(`[security] denied permission request: ${permission}`);
    callback(false);
  });
}

export function applySecurityPolicy(): void {
  const csp = contentSecurityPolicy();

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp],
      },
    });
  });

  app.on('web-contents-created', (_event, contents) => {
    hardenWebContents(contents);
  });
}
