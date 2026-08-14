import { expect, test } from '@playwright/test';
import { freshWorkDir, screenshotSets } from './helpers/fixtures';
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
 * What that refusal must NOT look like is a crash. Until now this still published a
 * red "Comparison failed", with the command line buried in the sentence and a stray
 * `*and*` where someone had written markdown into an engine's error string — so the
 * one picture on the page for this engine said the app was broken. Nothing failed:
 * `EngineUnsupportedError` is a documented limit of this host, the panel titles and
 * colours it as one, and the command is its own element. Feeding the engine better
 * screenshots would not have changed any of that — no input can, which is the point.
 *
 * This is one of a **pair**. `cli.capture.ts` photographs the terminal actually
 * running the command this panel names, over the same two folders — `screenshotSets`
 * is shared for exactly that reason. Between them the page can say "here is what the
 * app does, and here is where it happens", which one picture of a refusal cannot.
 *
 * The fixture is still built properly, because the refusal has to be the *right*
 * refusal: two genuine folders of PNGs, one badly regressed, one identical, and one
 * moved by fewer pixels than the per-image budget allows.
 */

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

    // The picture has to show a *limit*, not a casualty. "Comparison failed" in
    // red is what this still published until now, and a reader of
    // /docs/engines/visual could only read it as a broken app.
    await expect(panel).toContainText('Not available in the app');
    await expect(panel).not.toContainText('Comparison failed');
    await expect(harness.page.getByTestId('copy-details')).toHaveCount(0);

    // The command is its own element, set in mono, and typed exactly as it would
    // be typed — not a command line running through the middle of a paragraph.
    const command = harness.page.getByTestId('error-command');
    await expect(command).toHaveText('twinscope baseline/ current/ --engine visual');
    expect(await command.evaluate((element) => getComputedStyle(element).fontFamily)).toContain(
      'mono',
    );

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
