#!/usr/bin/env node
/**
 * Guarantees the Electron binary is present after `pnpm install`.
 *
 * Why this exists: pnpm 11 does not reliably run electron's own `postinstall`
 * in this workspace. `allowBuilds.electron: true` permits it, but the script is
 * skipped anyway (verified 2026-08-12: neither `--force` nor disabling the
 * side-effects cache triggers it), which leaves `node_modules/electron` without
 * its `dist/` — so `electron-vite dev` fails on a fresh clone.
 *
 * This runs electron's own installer directly when the binary is missing, and
 * is a no-op (one stat call) once it is there.
 *
 * Revisit: drop this script if a future pnpm runs the postinstall correctly.
 */
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// CI jobs that only typecheck/lint/test have no use for a 300 MB binary.
if (process.env.ELECTRON_SKIP_BINARY_DOWNLOAD === '1') {
  console.log('[ensure-electron] ELECTRON_SKIP_BINARY_DOWNLOAD=1 — skipping');
  process.exit(0);
}

const electronDir = join(repoRoot, 'node_modules', 'electron');

if (!existsSync(join(electronDir, 'install.js'))) {
  console.log('[ensure-electron] electron not installed yet — nothing to do');
  process.exit(0);
}

if (existsSync(join(electronDir, 'dist'))) {
  process.exit(0);
}

console.log('[ensure-electron] Electron binary missing — running its installer…');
try {
  execFileSync(process.execPath, [join(electronDir, 'install.js')], {
    cwd: electronDir,
    stdio: 'inherit',
  });
} catch (error) {
  console.error('[ensure-electron] FAILED to download the Electron binary.');
  console.error('[ensure-electron] Fix manually with:');
  console.error(`[ensure-electron]   cd ${electronDir} && node install.js`);
  throw error;
}

if (!existsSync(join(electronDir, 'dist'))) {
  throw new Error('[ensure-electron] installer finished but dist/ is still missing');
}

console.log('[ensure-electron] Electron binary ready');
