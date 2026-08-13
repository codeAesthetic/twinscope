import { app } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Small, boot-critical preferences in a plain JSON file. Comparison history
 * lives in SQLite (`history.ts`); this file stays tiny so startup never waits on
 * a database — the window has to size itself before anything else happens.
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

export type ThemePreference = 'system' | 'dark' | 'light';

export interface Preferences {
  theme: ThemePreference;
  /**
   * Per-engine option defaults, seeded into every new comparison. Keyed by
   * engine id so `{ text: { ignoreWhitespace: false } }` only affects text.
   */
  engineDefaults: Record<string, Record<string, unknown>>;
  checkUpdates: boolean;
  /** Global Quick Compare (v0.2.14). Both default to off — see channels.ts. */
  globalShortcut: boolean;
  clipboardWatcher: boolean;
}

interface Settings {
  version: 1;
  window?: WindowState;
  preferences: Preferences;
}

const DEFAULT_PREFERENCES: Preferences = {
  theme: 'dark',
  engineDefaults: {},
  checkUpdates: true,
  globalShortcut: false,
  clipboardWatcher: false,
};

const DEFAULTS: Settings = { version: 1, preferences: DEFAULT_PREFERENCES };

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

/** Same principle: unknown or malformed preferences fall back, never throw. */
function parsePreferences(value: unknown): Preferences {
  if (typeof value !== 'object' || value === null) return { ...DEFAULT_PREFERENCES };
  const candidate = value as Record<string, unknown>;
  const theme = candidate['theme'];
  const engineDefaults = candidate['engineDefaults'];

  return {
    theme: theme === 'dark' || theme === 'light' || theme === 'system' ? theme : 'dark',
    engineDefaults:
      typeof engineDefaults === 'object' && engineDefaults !== null
        ? (engineDefaults as Record<string, Record<string, unknown>>)
        : {},
    checkUpdates: candidate['checkUpdates'] !== false,
    // `=== true`, not `!== false`: an absent preference must stay OFF.
    globalShortcut: candidate['globalShortcut'] === true,
    clipboardWatcher: candidate['clipboardWatcher'] === true,
  };
}

export function readSettings(): Settings {
  if (cache) return cache;

  try {
    const raw: unknown = JSON.parse(readFileSync(settingsPath(), 'utf8'));
    const record = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
    const window = parseWindowState(record['window']);
    cache = {
      version: 1,
      ...(window ? { window } : {}),
      preferences: parsePreferences(record['preferences']),
    };
  } catch {
    cache = { ...DEFAULTS, preferences: { ...DEFAULT_PREFERENCES } };
  }

  return cache;
}

function persist(): void {
  try {
    writeFileSync(settingsPath(), JSON.stringify(cache, null, 2), 'utf8');
  } catch (error) {
    // A failed preference write must never take the app down.
    console.error('[settings] failed to persist:', error);
  }
}

export function saveWindowState(state: WindowState): void {
  cache = { ...readSettings(), window: state };
  persist();
}

export function readPreferences(): Preferences {
  return readSettings().preferences;
}

/** Shallow merge, so a caller can save one preference without reading them all. */
export function savePreferences(patch: Partial<Preferences>): Preferences {
  const current = readSettings();
  cache = { ...current, preferences: { ...current.preferences, ...patch } };
  persist();
  return cache.preferences;
}
