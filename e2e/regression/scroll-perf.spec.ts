import { expect, test } from '@playwright/test';
import { launchApp } from '../helpers/launch';

/**
 * REGRESSION — the §3.8 scroll budget, the one row that was never instrumented.
 *
 * This is a real measurement, not an assertion shaped like one: it samples
 * `requestAnimationFrame` deltas while the diff is actually scrolling, and
 * reports the distribution. The budget is 60 fps on a virtualised result.
 *
 * The assertion is deliberately a *floor* rather than the budget. Frame pacing
 * on a shared CI box is not the owner's machine, and a test that fails because
 * another process got the CPU teaches nothing. The printed p95 is the number
 * worth reading; the assertion only catches a collapse — a virtualiser that
 * started measuring every row, say, or a highlighter that stopped caching.
 */

/** Enough rows that a non-virtualised renderer would be obvious. */
const LINES = 50_000;

function generate(seed: string): string {
  const lines: string[] = [];
  for (let index = 0; index < LINES; index += 1) {
    lines.push(
      index % 40 === 0
        ? `const ${seed}Value${index} = ${index}; // edited`
        : `const sharedValue${index} = ${index};`,
    );
  }
  return lines.join('\n');
}

test('scroll performance: a 50k-row diff scrolls without dropping to a crawl', async () => {
  const harness = await launchApp();

  try {
    const paste = async (text: string): Promise<void> => {
      await harness.app.evaluate(
        ({ clipboard }, value: string) => clipboard.writeText(value),
        text,
      );
      await harness.page.keyboard.press('Meta+Shift+V');
    };

    await paste(generate('before'));
    await paste(generate('after'));
    await harness.page.getByTestId('compare-button').click();

    const diff = harness.page.getByTestId('text-diff');
    await expect(diff).toBeVisible({ timeout: 60_000 });

    // Virtualisation check first: the DOM must hold a screenful, not 50k rows.
    const renderedRows = await diff.locator('.dd-drow').count();
    expect(renderedRows).toBeLessThan(200);

    /**
     * Sample frame deltas while scrolling. Each frame advances the scroll and
     * records how long the previous frame took, so the numbers describe frames
     * that actually did the work of re-rendering rows.
     */
    const deltas: number[] = await diff.evaluate(async (element: Element) => {
      const scroller = element as HTMLElement;
      scroller.scrollTop = 0;

      return new Promise<number[]>((resolve) => {
        const samples: number[] = [];
        let previous = performance.now();
        let frames = 0;

        const step = (now: number): void => {
          samples.push(now - previous);
          previous = now;
          scroller.scrollTop += 240;
          frames += 1;
          if (frames < 120) requestAnimationFrame(step);
          else resolve(samples);
        };

        requestAnimationFrame(step);
      });
    });

    // Discard the first few frames: they include the scroll starting up.
    const measured = deltas.slice(5).sort((one, two) => one - two);
    const at = (quantile: number): number => measured[Math.floor(measured.length * quantile)] ?? 0;

    const median = at(0.5);
    const p95 = at(0.95);
    const fps = 1000 / median;

    console.log(
      `[scroll-perf] ${measured.length} frames · median ${median.toFixed(1)}ms ` +
        `(${fps.toFixed(0)} fps) · p95 ${p95.toFixed(1)}ms · rows in DOM ${renderedRows}`,
    );

    // The floor: 30 fps sustained. Anything slower is a structural regression,
    // not machine noise.
    expect(median).toBeLessThan(33);
    expect(p95).toBeLessThan(100);

    // The scroll genuinely moved through the document.
    expect(await diff.evaluate((element) => (element as HTMLElement).scrollTop)).toBeGreaterThan(
      10_000,
    );

    expect(harness.errors, `errors:\n${harness.errors.join('\n')}`).toEqual([]);
  } finally {
    await harness.close();
  }
});
