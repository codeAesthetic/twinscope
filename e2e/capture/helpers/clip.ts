import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import type { Harness } from '../../helpers/launch';
import { CLIPS_DIR, statusBarTop, VIEWPORT } from './stage';

/**
 * Screen recording for the GIFs (MEDIA-1).
 *
 * Playwright only produces webm, and only for a whole context — recording starts
 * when the window appears and stops when the app closes, so every clip contains
 * the boot and the setup as well as the part worth showing. Rather than trying to
 * start the recorder late, each clip writes a **sidecar** next to its webm saying
 * which slice of it matters, and `scripts/make-media.mjs` trims to that.
 *
 * The offsets cannot be exact: video zero is when Chromium starts capturing,
 * which is a few hundred milliseconds before this file can observe anything. So
 * `begin()` and `end()` both **hold the frame still** either side of the mark —
 * a mark that lands a beat early or late then still lands on the same picture,
 * which matters because the first frame of the GIF is also its poster image.
 */

/** How long the app sits still before the marked start, and after it. */
const LEAD_IN_MS = 1000;
const SETTLE_MS = 400;
/** How long it sits still before the marked end. */
const LEAD_OUT_MS = 700;
const TAIL_MS = 500;

export interface ClipSidecar {
  id: string;
  startMs: number;
  endMs: number;
  /** Height to crop the video to, dropping the live "Compared in N ms". */
  cropHeight: number;
  width: number;
  height: number;
}

export interface Clip {
  readonly id: string;
  readonly recordVideo: { dir: string; size: { width: number; height: number } };
  /** Call immediately after `stage()` returns: this is the video's time origin. */
  ready(): void;
  /** Holds the current state, marks the start of the interesting part. */
  begin(harness: Harness): Promise<void>;
  /** Holds the final state, marks the end. */
  end(harness: Harness): Promise<void>;
  /** After `harness.close()`: moves the webm in and writes the sidecar. */
  save(page: Page): Promise<void>;
}

export function newClip(id: string): Clip {
  const dir = join(CLIPS_DIR, id);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });

  let origin = 0;
  let startMs = 0;
  let endMs = 0;
  let cropHeight = VIEWPORT.height;

  return {
    id,
    recordVideo: { dir, size: { ...VIEWPORT } },

    ready() {
      origin = Date.now();
    },

    async begin(harness) {
      await harness.page.waitForTimeout(LEAD_IN_MS);
      startMs = Date.now() - origin;
      await harness.page.waitForTimeout(SETTLE_MS);
    },

    async end(harness) {
      await harness.page.waitForTimeout(LEAD_OUT_MS);
      endMs = Date.now() - origin;
      cropHeight = await statusBarTop(harness);
      await harness.page.waitForTimeout(TAIL_MS);
    },

    async save(page) {
      const video = page.video();
      if (video === null) throw new Error(`clip ${id}: no video was recorded`);
      await video.saveAs(join(dir, `${id}.webm`));
      await video.delete();

      const sidecar: ClipSidecar = {
        id,
        startMs,
        endMs,
        cropHeight,
        width: VIEWPORT.width,
        height: VIEWPORT.height,
      };
      writeFileSync(join(dir, `${id}.json`), `${JSON.stringify(sidecar, null, 2)}\n`);
      console.log(
        `[capture] clip ${id} — ${((endMs - startMs) / 1000).toFixed(1)}s of interest ` +
          `(${(startMs / 1000).toFixed(1)}s → ${(endMs / 1000).toFixed(1)}s)`,
      );
    },
  };
}

/**
 * A deliberate pause between two actions in a clip, so a viewer can see what
 * happened. Named rather than inlined because the number is a *pacing* decision,
 * not a wait for the app.
 */
export async function beat(page: Page, ms = 700): Promise<void> {
  await page.waitForTimeout(ms);
}
