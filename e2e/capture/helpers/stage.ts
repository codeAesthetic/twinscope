import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect, type Locator } from '@playwright/test';
import { launchApp, type Harness, type LaunchOptions } from '../../helpers/launch';

/**
 * The capture stage (MEDIA-1): one window size, one device pixel ratio, one way
 * to take a shot — so every asset on the documentation site matches every other.
 *
 * Determinism is the whole point. Anything that would differ between two runs of
 * the same capture is either pinned here or deliberately kept out of frame:
 *
 *  - **Window size** is set explicitly, not inherited from a saved window state.
 *  - **Device pixel ratio** is overridden to 2 via CDP rather than taken from the
 *    host display, so a non-retina machine produces the same PNG.
 *  - **Animations and the text caret** are disabled in every screenshot.
 *  - **The status bar carries a live "Compared in N ms"**, which is the one
 *    genuinely unrepeatable pixel in the app. Comparison stills leave it out of
 *    frame (`statusBar: false`) instead of faking the number.
 */

export const VIEWPORT = { width: 1440, height: 900 };
export const DEVICE_SCALE_FACTOR = 2;

const appRoot = resolve(__dirname, '..', '..', '..');
export const MEDIA_DIR = join(appRoot, 'e2e', '.artifacts', 'media');
export const STILLS_DIR = join(MEDIA_DIR, 'stills');
export const CLIPS_DIR = join(MEDIA_DIR, 'clips');
/**
 * Shots that are not assets themselves: `scripts/make-media.mjs` composites them
 * into one still (the four image modes) rather than shipping them individually.
 */
export const TILES_DIR = join(MEDIA_DIR, 'tiles');

export interface StageOptions extends LaunchOptions {
  /**
   * Recording a clip: the window keeps the host's pixel ratio, because the video
   * is captured at window size and a metrics override would fight it.
   */
  recording?: boolean;
}

/**
 * Boots the app at exactly 1440×900 and returns the harness.
 *
 * Fails loudly if the built app is missing: the harness silently falls back to
 * its fixture app, and a capture of the fixture is a picture of nothing.
 */
export async function stage(options: StageOptions = {}): Promise<Harness> {
  const { recording = false, ...launchOptions } = options;
  const harness = await launchApp(launchOptions);

  expect(
    harness.target,
    'captures must run against the built app — run `npm run build` first',
  ).toBe('app');

  await harness.app.evaluate(({ BrowserWindow }, size) => {
    const window = BrowserWindow.getAllWindows()[0];
    window?.setContentSize(size.width, size.height);
  }, VIEWPORT);

  if (!recording) {
    const session = await harness.page.context().newCDPSession(harness.page);
    await session.send('Emulation.setDeviceMetricsOverride', {
      ...VIEWPORT,
      deviceScaleFactor: DEVICE_SCALE_FACTOR,
      mobile: false,
    });
  }

  await expect.poll(() => harness.page.evaluate(() => window.innerWidth)).toBe(VIEWPORT.width);

  return harness;
}

export interface StillOptions {
  /** Clip to the union of these elements (test ids or locators), padded. */
  clip?: ReadonlyArray<Locator | string>;
  /** Padding around a clip, in CSS pixels. */
  pad?: number;
  /** Keep the status bar in a full-window shot. Defaults to true. */
  statusBar?: boolean;
}

/** Writes `e2e/.artifacts/media/stills/<id>.png` and returns its path. */
export async function still(
  harness: Harness,
  id: string,
  options: StillOptions = {},
): Promise<string> {
  return shoot(STILLS_DIR, harness, id, options);
}

/** Same, into the tiles directory — an input to a composited still, not an asset. */
export async function tile(
  harness: Harness,
  id: string,
  options: StillOptions = {},
): Promise<string> {
  return shoot(TILES_DIR, harness, id, options);
}

async function shoot(
  dir: string,
  harness: Harness,
  id: string,
  options: StillOptions,
): Promise<string> {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${id}.png`);
  const clip =
    options.clip === undefined
      ? await fullWindowClip(harness, options.statusBar ?? true)
      : await unionClip(harness, options.clip, options.pad ?? 12);

  await harness.page.screenshot({
    path,
    clip,
    animations: 'disabled',
    caret: 'hide',
    scale: 'device',
  });

  const kind = dir === TILES_DIR ? 'tile' : 'still';
  console.log(`[capture] ${kind} ${id} — ${clip.width}×${clip.height} css px`);
  return path;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function fullWindowClip(harness: Harness, statusBar: boolean): Promise<Rect> {
  const height = statusBar ? VIEWPORT.height : await statusBarTop(harness);
  return { x: 0, y: 0, width: VIEWPORT.width, height };
}

/** The y of the status bar's top edge — the cut line for a comparison still. */
export async function statusBarTop(harness: Harness): Promise<number> {
  return harness.page.evaluate(() => {
    const bar = document.querySelector('[data-testid="statusbar"]');
    return bar === null ? window.innerHeight : Math.round(bar.getBoundingClientRect().top);
  });
}

async function unionClip(
  harness: Harness,
  targets: ReadonlyArray<Locator | string>,
  pad: number,
): Promise<Rect> {
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;

  for (const target of targets) {
    const locator = typeof target === 'string' ? harness.page.getByTestId(target) : target;
    const box = await locator.boundingBox();
    if (box === null) throw new Error(`clip target has no box: ${String(target)}`);
    left = Math.min(left, box.x);
    top = Math.min(top, box.y);
    right = Math.max(right, box.x + box.width);
    bottom = Math.max(bottom, box.y + box.height);
  }

  // Integers only: a half-pixel clip resamples the shot and softens the text.
  const x = Math.max(0, Math.floor(left - pad));
  const y = Math.max(0, Math.floor(top - pad));
  return {
    x,
    y,
    width: Math.min(VIEWPORT.width - x, Math.ceil(right + pad) - x),
    height: Math.min(VIEWPORT.height - y, Math.ceil(bottom + pad) - y),
  };
}

/**
 * Stubs the native open dialog for the rest of the launch: the first click gets
 * the first path, the second the second. Playwright cannot drive an OS dialog,
 * and stubbing only the dialog keeps intake, IPC and detection real.
 */
export async function stubPicker(harness: Harness, paths: string[]): Promise<void> {
  await harness.app.evaluate(({ dialog }, files: string[]) => {
    let call = 0;
    dialog.showOpenDialog = () =>
      Promise.resolve({ canceled: false, filePaths: [files[call++] ?? files[0]!] });
  }, paths);
}

/** Stubs the native save dialog to one known path. */
export async function stubSave(harness: Harness, path: string): Promise<void> {
  await harness.app.evaluate(({ dialog }, file: string) => {
    dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath: file });
  }, path);
}

/**
 * Freezes the renderer's clock.
 *
 * Only the export path needs it: the HTML report stamps `new Date()` into its
 * header, so without this the report capture differs on every run.
 */
export async function freezeClock(harness: Harness): Promise<void> {
  await harness.page.clock.setFixedTime(new Date('2026-03-04T09:41:00Z'));
}

/** Loads a file pair through the real picker buttons. */
export async function openPair(harness: Harness, pair: { before: string; after: string }) {
  await stubPicker(harness, [pair.before, pair.after]);
  await harness.page.getByTestId('pick-file-before').click();
  await harness.page.getByTestId('pick-file-after').click();
}

/** Loads a folder pair through the real picker buttons. */
export async function openFolderPair(
  harness: Harness,
  pair: { before: string; after: string },
): Promise<void> {
  await stubPicker(harness, [pair.before, pair.after]);
  await harness.page.getByTestId('pick-folder-before').click();
  await harness.page.getByTestId('pick-folder-after').click();
}
