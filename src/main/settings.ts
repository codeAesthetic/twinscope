import { app } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Small, boot-critical preferences in a plain JSON file. Comparison history
 * moves to SQLite at MVP-8; this file stays tiny so startup never waits on a
 * database.
 *
 * Never store file *contents* here — window geometry and preferences only.
 */

export interface WindowState {
  width: number;
  height: number;
  x?: number;
  y?: number;
  maximized: boolean;
}

interface Settings {
  version: 1;
  window?: WindowState;
}

const DEFAULTS: Settings = { version: 1 };

let cache: Settings | null = null;

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json');
}

/** Hand-rolled validation: a corrupt file must never stop the app from opening. */
function parseWindowState(value: unknown): WindowState | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const candidate = value as Record<string, unknown>;
  const { width, height, x, y, maximized } = candidate;
  if (typeof width !== 'number' || typeof height !== 'number') return undefined;
  if (width < 320 || height < 240) return undefined;

  return {
    width: Math.round(width),
    height: Math.round(height),
    ...(typeof x === 'number' ? { x: Math.round(x) } : {}),
    ...(typeof y === 'number' ? { y: Math.round(y) } : {}),
    maximized: maximized === true,
  };
}

export function readSettings(): Settings {
  if (cache) return cache;

  try {
    const raw: unknown = JSON.parse(readFileSync(settingsPath(), 'utf8'));
    const record = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
    const window = parseWindowState(record['window']);
    cache = { version: 1, ...(window ? { window } : {}) };
  } catch {
    cache = { ...DEFAULTS };
  }

  return cache;
}

export function saveWindowState(state: WindowState): void {
  cache = { ...readSettings(), window: state };
  try {
    writeFileSync(settingsPath(), JSON.stringify(cache, null, 2), 'utf8');
  } catch (error) {
    // A failed preference write must never take the app down.
    console.error('[settings] failed to persist:', error);
  }
}
