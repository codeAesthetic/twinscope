import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { freshWorkDir } from './helpers/fixtures';
import { boxes, encodePng, type Box, type Rgba } from './helpers/png';
import { openFolderPair, stage, still } from './helpers/stage';

/**
 * MEDIA-1 still for the visual-regression engine (v0.3.5) — and it is a still of
 * the app **refusing**, deliberately.
 *
 * There is no desktop screenshot of a visual comparison to take. The engine needs a
 * host that can list directories *and* decode images: the engine worker has no
 * decoder, the renderer has one but cannot list a directory, and pushing a baseline
 * set through IPC as bytes is what the big-inputs rule forbids. Its priority is 0 so
 * detection never picks it either. The only way to run it is the command line.
 *
 * So the one thing the app can honestly show a reader of `/docs/engines/visual` is
 * the state they will actually reach if they try it here: the refusal, which names
 * the exact command to run instead, beside the fallback that compares the same two
 * folders the way the app *can*. Inventing a terminal panel inside the window to
 * dress up CLI output would put a UI that does not exist next to nine that do.
 *
 * The CLI's own output is not photographed and does not need to be: it is text, so
 * the documentation can carry it as a code block, and `e2e/regression/ci.spec.ts`
 * already drives the built binary over a real screenshot set — thresholds, worst-first
 * ordering, both meanings of exit 1 — so the command this picture names is covered by
 * an assertion rather than by a caption.
 *
 * The fixture is still built properly, because the refusal has to be the *right*
 * refusal: two genuine folders of PNGs, one badly regressed, one identical, and one
 * moved by fewer pixels than the per-image budget allows.
 */

const INK = {
  bg: [14, 17, 23, 255] as Rgba,
  panel: [22, 27, 34, 255] as Rgba,
  line: [48, 54, 61, 255] as Rgba,
  text: [110, 118, 129, 255] as Rgba,
  accent: [110, 168, 255, 255] as Rgba,
  warn: [227, 179, 65, 255] as Rgba,
  good: [63, 185, 80, 255] as Rgba,
};

const WIDTH = 640;
const HEIGHT = 400;

interface Variant {
  /** The primary button's fill and left edge — the big regression. */
  button: Rgba;
  buttonX: number;
  /** A 14×14 status dot: 196 of 256 000 pixels, under the 0.1% per-image budget. */
  dot: Rgba;
}

/** One pinned "screenshot" of a fictional app screen. */
function screenshot({ button, buttonX, dot }: Variant): Buffer {
  const list: Box[] = [
    { x: 0, y: 0, w: WIDTH, h: 44, fill: INK.panel },
    { x: 20, y: 16, w: 120, h: 12, fill: INK.text },
    { x: 0, y: 44, w: 150, h: HEIGHT - 44, fill: INK.panel },
    ...[0, 1, 2, 3].map((row) => ({ x: 18, y: 70 + row * 30, w: 110, h: 10, fill: INK.line })),
    { x: 174, y: 76, w: 420, h: 150, fill: INK.panel },
    { x: 194, y: 96, w: 180, h: 14, fill: INK.text },
    ...[0, 1, 2].map((row) => ({ x: 194, y: 126 + row * 20, w: 340, h: 10, fill: INK.line })),
    { x: 194, y: 196, w: 14, h: 14, fill: dot },
    { x: buttonX, y: 250, w: 130, h: 34, fill: button },
    { x: 400, y: 250, w: 110, h: 34, fill: INK.line },
  ];
  return encodePng(WIDTH, HEIGHT, boxes(INK.bg, list));
}

const STEADY: Variant = { button: INK.accent, buttonX: 194, dot: INK.good };

/** Two directories of screenshots: one regression, one identical, one under budget. */
function screenshotSets(dir: string): { before: string; after: string } {
  const before = join(dir, 'baseline');
  const after = join(dir, 'current');
  mkdirSync(before, { recursive: true });
  mkdirSync(after, { recursive: true });

  const pairs: Array<[string, Variant, Variant]> = [
    // A recoloured, moved primary button: a few thousand pixels, and a real regression.
    ['checkout.png', STEADY, { button: INK.warn, buttonX: 240, dot: INK.good }],
    // Byte-identical, which is what most of a real suite looks like.
    ['settings.png', STEADY, STEADY],
    // 196 pixels — under the per-image budget on purpose, because anti-aliasing moves
    // a handful of pixels on every run and zero is the wrong number to gate on.
    ['sign-in.png', STEADY, { ...STEADY, dot: INK.warn }],
  ];

  for (const [name, one, other] of pairs) {
    writeFileSync(join(before, name), screenshot(one));
    writeFileSync(join(after, name), screenshot(other));
  }

  return { before, after };
}

test('stills: visual regression is command-line only, and says so', async () => {
  const harness = await stage();
  expect(harness.target).toBe('app');
  const dir = freshWorkDir('visual');

  try {
    await openFolderPair(harness, screenshotSets(dir));

    // Detection will not choose this engine — two folders of screenshots and two
    // folders of source code are indistinguishable from the outside — so the reader
    // gets here the only way there is: by asking for it.
    await expect(harness.page.getByTestId('detected-bar')).toContainText('File tree diff');
    await harness.page.getByTestId('engine-select').selectOption('visual');
    await expect(harness.page.getByTestId('detected-bar')).toContainText('Visual regression');

    await harness.page.getByTestId('compare-button').click();

    const panel = harness.page.getByTestId('job-error');
    await expect(panel).toBeVisible({ timeout: 30_000 });
    // The refusal names the command, exactly as it would have to be typed.
    await expect(panel).toContainText('twinscope baseline/ current/ --engine visual');
    await expect(panel).toContainText('read directories');
    // …and it offers the engine that can still say something about these two folders,
    // rather than leaving a dead end.
    await expect(harness.page.getByTestId('error-fallback')).toHaveText('Compare as folders');

    /*
     * The status bar is cut, even though a refusal never publishes "Compared in N ms"
     * — the unrepeatable pixel this rule was written for. Its right-hand side prints
     * the running Electron version (`electron 43.4.0`), which is just as bad in a
     * published still for a different reason: it is stale the day Electron is bumped,
     * and the picture would then describe a build nobody is running.
     */
    await still(harness, 'visual-regression', { statusBar: false });

    expect(harness.errors, `errors:\n${harness.errors.join('\n')}`).toEqual([]);
  } finally {
    await harness.close();
  }
});
