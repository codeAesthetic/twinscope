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
function png(paint: (x: number, y: number) => [number, number, number, number]): Buffer {
  const raw = Buffer.alloc(HEIGHT * (WIDTH * 4 + 1));
  let at = 0;
  for (let y = 0; y < HEIGHT; y += 1) {
    raw[at++] = 0; // filter: none
    for (let x = 0; x < WIDTH; x += 1) {
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
  header.writeUInt32BE(WIDTH, 0);
  header.writeUInt32BE(HEIGHT, 4);
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
