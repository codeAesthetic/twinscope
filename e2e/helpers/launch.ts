import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const here = __dirname;
const appRoot = resolve(here, '../..');

/** The real app, once `npm run build` has produced it (SETUP-2 onward). */
export const REAL_APP_ENTRY = join(appRoot, 'out', 'main', 'index.js');

/**
 * A minimal Electron app used only to prove the harness itself works. It stays
 * as a control: if `verify` fails against the real app but passes here, the
 * harness is fine and the app is broken.
 */
export const FIXTURE_APP_ENTRY = join(here, '..', 'fixtures', 'harness-app', 'main.cjs');

export const SCREENSHOT_DIR = join(appRoot, 'e2e', '.artifacts', 'screenshots');

export type LaunchTarget = 'app' | 'fixture';

export function resolveTarget(): { entry: string; target: LaunchTarget } {
  return existsSync(REAL_APP_ENTRY)
    ? { entry: REAL_APP_ENTRY, target: 'app' }
    : { entry: FIXTURE_APP_ENTRY, target: 'fixture' };
}

export interface Harness {
  app: ElectronApplication;
  page: Page;
  target: LaunchTarget;
  /** Host platform, for assertions about platform-specific chrome. */
  platform: NodeJS.Platform;
  /** Renderer console output, newest last. */
  logs: string[];
  /** Renderer console.error lines + uncaught exceptions. Assert this is empty. */
  errors: string[];
  /** Saves a PNG under e2e/.artifacts/screenshots and returns its absolute path. */
  screenshot(name: string): Promise<string>;
  close(): Promise<void>;
}

export interface LaunchOptions {
  /**
   * Reuse a specific profile directory instead of a throwaway one. Pass the same
   * path to two launches to test what survives a restart (MVP-8); the caller
   * owns cleanup in that case.
   */
  userDataDir?: string;
  /**
   * Record a webm of the window into `dir`. Only the media capture harness
   * (MEDIA-1) uses this: the file is an intermediate that ffmpeg turns into a
   * GIF, and it is finalised on `close()`, so read `page.video()` after that.
   */
  recordVideo?: { dir: string; size?: { width: number; height: number } };
  /**
   * Extra environment for the launched app. `update.spec.ts` uses it to point
   * `TWINSCOPE_UPDATE_FEED` at a server on 127.0.0.1, so the one network call the
   * app can make is exercised for real without leaving the machine — main only
   * honours that variable under `NODE_ENV=test`, which is set below.
   */
  env?: Record<string, string>;
}

/**
 * Boots the app (or the fixture) and wires up console/error capture.
 *
 * Always close it in a `finally` — a leaked Electron process will block the
 * next run.
 */
export async function launchApp(options: LaunchOptions = {}): Promise<Harness> {
  const { entry, target } = resolveTarget();

  if (target === 'fixture') {
    console.log(
      '[harness] Real app not built (no out/main/index.js) — launching the fixture app.\n' +
        '[harness] Run `npm run build` first to verify the actual application.',
    );
  }

  // A private user-data dir per launch. Without it the app's single-instance
  // lock makes the second launch in a run quit immediately, and runs would
  // leak settings into each other.
  const ownsProfile = options.userDataDir === undefined;
  const userDataDir = options.userDataDir ?? mkdtempSync(join(tmpdir(), 'twinscope-e2e-'));

  const app = await electron.launch({
    args: [entry, `--user-data-dir=${userDataDir}`],
    // Keeps Electron quiet about being unsigned/dev in CI-ish contexts.
    env: { ...process.env, NODE_ENV: 'test', ELECTRON_ENABLE_LOGGING: '1', ...options.env },
    ...(options.recordVideo !== undefined ? { recordVideo: options.recordVideo } : {}),
  });

  const logs: string[] = [];
  const errors: string[] = [];

  // Main-process output. Without this, a main that dies during load looks like
  // an unexplained "waiting for window" timeout — which is exactly how the
  // bundled-electron-shim bug presented during SETUP-2.
  //
  // Electron routes ordinary INFO logging to stderr, so only genuinely angry
  // lines count as errors; everything else is kept in `logs` for debugging.
  const looksFatal = (text: string): boolean =>
    /\b(ERROR|FATAL)\b|Uncaught|Unhandled|\bError:/.test(text) && !/\bINFO\b/.test(text);

  const mainProcess = app.process();
  mainProcess.stdout?.on('data', (chunk: Buffer) => {
    logs.push(`[main] ${chunk.toString().trimEnd()}`);
  });
  mainProcess.stderr?.on('data', (chunk: Buffer) => {
    const text = `[main:stderr] ${chunk.toString().trimEnd()}`;
    logs.push(text);
    if (looksFatal(text)) errors.push(text);
  });

  let page: Page;
  try {
    page = await app.firstWindow();
  } catch (cause) {
    // Surface what main said before rethrowing the opaque timeout.
    console.error('[harness] no window appeared. Main process output:');
    console.error(logs.length > 0 ? logs.join('\n') : '  (main printed nothing)');
    await app.close().catch(() => undefined);
    throw cause;
  }

  await page.waitForLoadState('domcontentloaded');

  page.on('console', (message) => {
    const line = `[${message.type()}] ${message.text()}`;
    logs.push(line);
    if (message.type() === 'error') errors.push(line);
  });
  page.on('pageerror', (error) => {
    errors.push(`[pageerror] ${error.message}`);
  });

  return {
    app,
    page,
    target,
    platform: process.platform,
    logs,
    errors,
    async screenshot(name: string) {
      mkdirSync(SCREENSHOT_DIR, { recursive: true });
      const file = join(SCREENSHOT_DIR, `${name}.png`);
      await page.screenshot({ path: file });
      console.log(`[harness] screenshot → ${file}`);
      return file;
    },
    async close() {
      await app.close();
      // A caller-supplied profile is the caller's to delete — it is the whole
      // point of passing one in.
      if (ownsProfile) rmSync(userDataDir, { recursive: true, force: true });
    },
  };
}
