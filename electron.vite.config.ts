import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import type { Plugin } from 'vite';

/**
 * Deliberately minimal — electron-vite's defaults already point at
 * `src/main/index.ts`, `src/preload/index.ts` and `src/renderer/index.html`,
 * so there is nothing to configure but plugins.
 *
 * The package is CommonJS (no `"type": "module"`), which is what keeps this
 * simple: main and preload build to CJS, and a sandboxed preload requires CJS.
 */

/**
 * Dev needs Vite's HMR websocket and React Refresh's inline preamble;
 * production needs neither. One `%CSP%` placeholder in index.html keeps the
 * markup from drifting out of sync with the real policy.
 */
function csp(isDev: boolean): Plugin {
  const policy = [
    "default-src 'self'",
    isDev ? "script-src 'self' 'unsafe-inline'" : "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    isDev ? "connect-src 'self' ws: http://localhost:*" : "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    // NOTE: no `frame-ancestors` here — it is header-only, and Chromium logs a
    // console warning when it appears in a <meta> tag. It IS set by the header
    // in src/main/security.ts, which is where it actually takes effect.
  ].join('; ');

  return {
    name: 'devdiff:csp',
    transformIndexHtml: (html) => html.replace('%CSP%', policy),
  };
}

export default defineConfig(({ mode }) => {
  const isDev = mode !== 'production';

  return {
    main: { plugins: [externalizeDepsPlugin()] },
    preload: { plugins: [externalizeDepsPlugin()] },
    renderer: { plugins: [react(), tailwindcss(), csp(isDev)] },
  };
});
