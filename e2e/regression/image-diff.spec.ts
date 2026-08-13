import { deflateSync } from 'node:zlib';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, test } from '@playwright/test';
import { launchApp } from '../helpers/launch';

/**
 * REGRESSION — MVP-7: the image engine and its viewer.
 *
 * The image comparison is the one job that runs in the renderer rather than the
 * engine host, so this spec is the only proof that path works end to end:
 * decode, pixel pass, region clustering, and a threshold change that re-runs it.
 *
 * The fixtures are PNGs written by hand — a real encoder for two flat rectangles
 * would be a dependency bought for one test.
 */

const WIDTH = 200;
const HEIGHT = 200;

/** Minimal truecolour-with-alpha PNG encoder. */
function png(
  paint: (x: number, y: number) => [number, number, number, number],
  width = WIDTH,
  height = HEIGHT,
): Buffer {
  const raw = Buffer.alloc(height * (width * 4 + 1));
  let at = 0;
  for (let y = 0; y < height; y += 1) {
    raw[at++] = 0; // filter: none
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a] = paint(x, y);
      raw[at++] = r;
      raw[at++] = g;
      raw[at++] = b;
      raw[at++] = a;
    }
  }

  const chunk = (type: string, body: Buffer): Buffer => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(body.length);
    const typed = Buffer.concat([Buffer.from(type, 'ascii'), body]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(typed));
    return Buffer.concat([length, typed, crc]);
  };

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: RGBA

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = (CRC_TABLE[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

const inBox = (x: number, y: number, left: number, top: number, size: number): boolean =>
  x >= left && x < left + size && y >= top && y < top + size;

/**
 * The changed squares are deliberately a *moderate* shade shift: 400 of a
 * possible 1020 channel distance. That is over the default 12% tolerance and
 * under the slider's 50% maximum, which is what makes the threshold assertion
 * below mean something.
 */
const BACKGROUND: [number, number, number, number] = [24, 24, 32, 255];
const CHANGED: [number, number, number, number] = [160, 160, 160, 255];

const BEFORE = png(() => BACKGROUND);
const AFTER = png((x, y) =>
  inBox(x, y, 20, 20, 40) || inBox(x, y, 140, 140, 40) ? CHANGED : BACKGROUND,
);

/**
 * Wider than the stage will ever be, which is the whole point: a fit that is not
 * computed from the measured stage cannot get this pair on screen. At 100% the
 * two panes are 4800px of content in a stage of roughly 950.
 */
const BIG = 2400;
const BIG_HEIGHT = 1600;
const BIG_BEFORE = png(() => BACKGROUND, BIG, BIG_HEIGHT);
const BIG_AFTER = png(
  (x, y) => (inBox(x, y, 200, 200, 400) ? CHANGED : BACKGROUND),
  BIG,
  BIG_HEIGHT,
);

/** Deliberately mismatched, so the union is 300×200 and neither side fills it. */
const NARROW = png(() => BACKGROUND, 200, 200);
const WIDE = png((x, y) => (inBox(x, y, 10, 10, 40) ? CHANGED : BACKGROUND), 300, 150);

test('image diff: regions, modes, zoom and threshold re-run', async () => {
  const harness = await launchApp();
  const root = await mkdtemp(join(tmpdir(), 'twinscope-img-'));

  try {
    const before = join(root, 'before.png');
    const after = join(root, 'after.png');
    await writeFile(before, BEFORE);
    await writeFile(after, AFTER);

    await harness.app.evaluate(
      ({ dialog }, paths: string[]) => {
        let call = 0;
        dialog.showOpenDialog = () =>
          Promise.resolve({ canceled: false, filePaths: [paths[call++] ?? paths[0]!] });
      },
      [before, after],
    );

    await harness.page.getByTestId('pick-file-before').click();
    await harness.page.getByTestId('pick-file-after').click();

    await expect(harness.page.getByTestId('detected-bar')).toContainText('Visual / pixel diff');
    await harness.page.getByTestId('compare-button').click();

    const stage = harness.page.getByTestId('image-stage');
    await expect(stage).toBeVisible({ timeout: 20_000 });

    // ---------- two changed squares become two regions ----------
    // 2 × 40² changed pixels out of 200² = 8%.
    await expect(harness.page.getByTestId('diff-pct')).toHaveText('8.00%');
    await expect(harness.page.getByTestId('summary-strip')).toContainText('8.00% difference');
    await expect(harness.page.getByTestId('summary-strip')).toContainText('2 regions');
    await expect(stage.locator('.dd-region')).toHaveCount(2);

    await harness.screenshot('image-side-by-side');

    // ---------- each mode swaps what the stage shows ----------
    await expect(harness.page.getByTestId('pane-before')).toBeVisible();
    await expect(harness.page.getByTestId('pane-after')).toBeVisible();

    await harness.page.getByRole('tab', { name: 'Difference' }).click();
    await expect(stage).toHaveAttribute('data-mode', 'difference');
    await expect(harness.page.getByTestId('pane-diff')).toBeVisible();
    // The heatmap is generated, not one of the inputs.
    await expect(harness.page.getByTestId('pane-diff').locator('img')).toHaveAttribute(
      'src',
      /^data:image\/png/,
    );
    await harness.screenshot('image-difference');

    await harness.page.getByRole('tab', { name: 'Overlay' }).click();
    await expect(harness.page.getByTestId('opacity')).toBeVisible();

    await harness.page.getByRole('tab', { name: 'Blink' }).click();
    await expect(harness.page.getByTestId('pane-blink')).toBeVisible();

    await harness.page.getByRole('tab', { name: 'Side-by-side' }).click();

    // ---------- zoom scales the pane, so region boxes stay on their pixels ----------
    const paneWidth = async (): Promise<number> =>
      (await harness.page.getByTestId('pane-before').boundingBox())?.width ?? 0;
    const atFit = await paneWidth();
    await harness.page.getByRole('button', { name: 'Zoom in' }).click();
    expect(await paneWidth()).toBeGreaterThan(atFit);
    await harness.page.getByRole('button', { name: 'Fit' }).click();

    // ---------- region list drives change navigation ----------
    await expect(harness.page.getByTestId('change-position')).toHaveText('– / 2');
    await harness.page.keyboard.press('Alt+ArrowDown');
    await expect(harness.page.getByTestId('change-position')).toHaveText('1 / 2');
    await expect(stage.locator('.dd-region[data-current="true"]')).toHaveCount(1);

    // ---------- a stricter threshold re-runs the comparison ----------
    // End takes a range input to its maximum — a real keyboard interaction,
    // which is the path a mouse drag ends up on too.
    const threshold = harness.page.getByTestId('threshold');
    await threshold.press('End');
    // At a 50% tolerance the white squares no longer clear the bar.
    await expect(harness.page.getByTestId('diff-pct')).toHaveText('0.00%', { timeout: 20_000 });
    await expect(harness.page.getByTestId('region-list')).toContainText('identical at this');

    expect(harness.errors, `errors:\n${harness.errors.join('\n')}`).toEqual([]);
  } finally {
    await harness.close();
    await rm(root, { recursive: true, force: true });
  }
});

/**
 * REGRESSION — the image viewer opens fitted.
 *
 * It used to open at 100% with a floor of 25%, which meant a large pair could
 * not be got on screen at all: seven clicks of − landed on two 600px panes in a
 * stage of roughly 950 and stopped there. Everything here is a size assertion
 * for that reason — a screenshot of a corner of a grey rectangle looks the same
 * whether the fit is right or wrong.
 */
test('image diff: a large pair opens fitted, and zoom walks a ladder from there', async () => {
  const harness = await launchApp();
  const root = await mkdtemp(join(tmpdir(), 'twinscope-imgfit-'));

  try {
    const before = join(root, 'big-before.png');
    const after = join(root, 'big-after.png');
    await writeFile(before, BIG_BEFORE);
    await writeFile(after, BIG_AFTER);

    await harness.app.evaluate(
      ({ dialog }, paths: string[]) => {
        let call = 0;
        dialog.showOpenDialog = () =>
          Promise.resolve({ canceled: false, filePaths: [paths[call++] ?? paths[0]!] });
      },
      [before, after],
    );

    // Scrollbars that TAKE SPACE, as they do on Windows, on Linux, on every CI
    // runner, and on any Mac set to "always show". macOS overlay scrollbars take
    // none, so without this the fit assertions below cannot fail here however
    // wrong the measurement is — which is exactly how a green local suite sat next
    // to a red CI for three runs.
    await harness.page.addStyleTag({
      content: '.dd-imgstage::-webkit-scrollbar { width: 15px; height: 15px; }',
    });

    await harness.page.getByTestId('pick-file-before').click();
    await harness.page.getByTestId('pick-file-after').click();
    await harness.page.getByTestId('compare-button').click();

    const stage = harness.page.getByTestId('image-stage');
    await expect(stage).toBeVisible({ timeout: 20_000 });
    await expect(harness.page.getByTestId('pane-after')).toBeVisible();

    const box = async (id: string): Promise<{ x: number; y: number; w: number; h: number }> => {
      const found = await harness.page.getByTestId(id).boundingBox();
      if (found === null) throw new Error(`${id} has no box`);
      return { x: found.x, y: found.y, w: found.width, h: found.height };
    };

    // ---------- both images are on screen, without being scrolled to ----------
    const stageBox = await box('image-stage');
    const beforeBox = await box('pane-before');
    const afterBox = await box('pane-after');

    expect(beforeBox.x).toBeGreaterThanOrEqual(stageBox.x - 1);
    expect(afterBox.x + afterBox.w).toBeLessThanOrEqual(stageBox.x + stageBox.w + 1);
    expect(beforeBox.y).toBeGreaterThanOrEqual(stageBox.y - 1);
    expect(beforeBox.y + beforeBox.h).toBeLessThanOrEqual(stageBox.y + stageBox.h + 1);

    // Nothing to scroll is the proof that it fits — the old floor left ~1150px.
    const overflow = await stage.evaluate((element) => ({
      x: element.scrollWidth - element.clientWidth,
      y: element.scrollHeight - element.clientHeight,
    }));
    expect(overflow.x).toBeLessThanOrEqual(1);
    expect(overflow.y).toBeLessThanOrEqual(1);

    // ---------- and the label says why it is 20-odd percent ----------
    const zoomValue = harness.page.getByTestId('zoom-value');
    await expect(zoomValue).toHaveAttribute('data-fit', 'true');
    await expect(zoomValue).toContainText('Fit');
    await expect(stage).toHaveAttribute('data-pannable', 'false');
    // Downsampling by this much has to be smoothed, or the image reads as moiré.
    await expect(stage).toHaveAttribute('data-smooth', 'true');

    await harness.screenshot('image-large-fitted');

    // ---------- 1:1 is actual pixels, and is pannable because it overflows ----------
    await harness.page.getByRole('button', { name: '1:1' }).click();
    await expect(zoomValue).toHaveText('100%');
    expect((await box('pane-before')).w).toBeCloseTo(BIG, -1);
    await expect(stage).toHaveAttribute('data-pannable', 'true');
    await expect(stage).toHaveAttribute('data-smooth', 'false');

    // ---------- dragging pans, which is the only way around at 100% ----------
    // The zoom keeps the centre of the view in the centre of the view, and
    // applies that a frame later — so sample after the frame, not before it.
    const scrolled = async (): Promise<number> =>
      stage.evaluate(
        (element) =>
          new Promise<number>((resolve) => {
            requestAnimationFrame(() => requestAnimationFrame(() => resolve(element.scrollLeft)));
          }),
      );

    const beforeDrag = await scrolled();
    expect(beforeDrag).toBeGreaterThan(0);
    await harness.page.mouse.move(stageBox.x + 400, stageBox.y + 300);
    await harness.page.mouse.down();
    await harness.page.mouse.move(stageBox.x + 200, stageBox.y + 300, { steps: 5 });
    await harness.page.mouse.up();
    expect(await scrolled()).toBeCloseTo(beforeDrag + 200, -1);

    // ---------- Fit goes back to fitting, rather than to 100% ----------
    // And to the SAME fit. At 100% the stage overflows, so a space-taking
    // scrollbar is on screen; measuring the stage with `clientWidth` then made
    // this fit ~2% smaller than the one the view opened with, because a fitted
    // pane does not overflow and gets the gutter back. The scrollbars forced
    // above are what makes this assertion able to fail.
    const scrollbar = await stage.evaluate((element) => ({
      x: element.getBoundingClientRect().width - element.clientWidth,
      y: element.getBoundingClientRect().height - element.clientHeight,
    }));
    expect(scrollbar.x, 'the forced scrollbar must take real space').toBeGreaterThan(1);

    const fitted = beforeBox.w;
    await harness.page.getByRole('button', { name: 'Fit' }).click();
    expect((await box('pane-before')).w).toBeCloseTo(fitted, 0);
    await expect(zoomValue).toHaveAttribute('data-fit', 'true');

    // ---------- ⌘-scroll and trackpad pinch, which arrive as the same event ----------
    // Synthesised rather than driven: Playwright's wheel cannot set ctrlKey, and
    // Chromium's pinch is not reachable at all. This proves the handler and its
    // arithmetic, not the gesture recogniser underneath it.
    await stage.evaluate((element) =>
      element.dispatchEvent(
        new WheelEvent('wheel', { deltaY: -400, ctrlKey: true, bubbles: true, cancelable: true }),
      ),
    );
    await expect(zoomValue).toHaveAttribute('data-fit', 'false');
    expect((await box('pane-before')).w).toBeGreaterThan(fitted);
    await harness.page.getByRole('button', { name: 'Fit' }).click();

    // ---------- one pane has more room than two, so fit re-fits per mode ----------
    await harness.page.getByRole('tab', { name: 'Difference' }).click();
    await expect(harness.page.getByTestId('pane-diff')).toBeVisible();
    expect((await box('pane-diff')).w).toBeGreaterThan(fitted);
    await harness.page.getByRole('tab', { name: 'Side-by-side' }).click();

    // ---------- zooming out from fit is bounded, not endless ----------
    for (let click = 0; click < 6; click += 1) {
      await harness.page.getByRole('button', { name: 'Zoom out' }).click();
    }
    const floored = (await box('pane-before')).w;
    expect(floored).toBeGreaterThan(0);
    expect(floored).toBeLessThanOrEqual(fitted + 1);

    expect(harness.errors, `errors:\n${harness.errors.join('\n')}`).toEqual([]);
  } finally {
    await harness.close();
    await rm(root, { recursive: true, force: true });
  }
});

/**
 * REGRESSION — a smaller image is padded onto the union, not stretched to it.
 *
 * The engine compares on the union of both sizes; the view used to stretch each
 * image to fill that union, so a 200×200 against a 300×150 was displayed 1.5×
 * too wide and 0.75× too tall — a distortion the pixel numbers never showed.
 */
test('image diff: mismatched sizes keep their own shape inside the union', async () => {
  const harness = await launchApp();
  const root = await mkdtemp(join(tmpdir(), 'twinscope-imgunion-'));

  try {
    const before = join(root, 'narrow.png');
    const after = join(root, 'wide.png');
    await writeFile(before, NARROW);
    await writeFile(after, WIDE);

    await harness.app.evaluate(
      ({ dialog }, paths: string[]) => {
        let call = 0;
        dialog.showOpenDialog = () =>
          Promise.resolve({ canceled: false, filePaths: [paths[call++] ?? paths[0]!] });
      },
      [before, after],
    );

    await harness.page.getByTestId('pick-file-before').click();
    await harness.page.getByTestId('pick-file-after').click();
    await harness.page.getByTestId('compare-button').click();

    await expect(harness.page.getByTestId('image-stage')).toBeVisible({ timeout: 20_000 });
    await expect(harness.page.getByTestId('image-side')).toContainText('300×150');

    // The union is 300×200, and both panes are laid out on it. Aspect ratio is
    // the border-independent way to say "not stretched", and it is the thing
    // that was actually wrong: a square rendered 1.5× wide and 0.75× tall.
    const shape = async (pane: string): Promise<{ width: number; ratio: number }> => {
      const image = await harness.page.getByTestId(pane).locator('img').first().boundingBox();
      if (image === null) throw new Error(`${pane} has no box`);
      return { width: image.width, ratio: image.width / image.height };
    };

    const narrow = await shape('pane-before');
    const wide = await shape('pane-after');

    // Exact, not approximate: the shot frame is an outline rather than a border
    // precisely so the canvas has no stray pixels in it.
    expect(narrow.ratio).toBeCloseTo(200 / 200, 3);
    expect(wide.ratio).toBeCloseTo(300 / 150, 3);
    // And they sit on one canvas, so their widths are in their true proportion.
    expect(narrow.width / wide.width).toBeCloseTo(200 / 300, 2);

    await harness.screenshot('image-union-padding');

    expect(harness.errors, `errors:\n${harness.errors.join('\n')}`).toEqual([]);
  } finally {
    await harness.close();
    await rm(root, { recursive: true, force: true });
  }
});
