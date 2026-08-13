import { expect, test, type Page } from '@playwright/test';
import { waitForReady } from '../helpers/seed';
import { DEVICE_SCALE_FACTOR, stage, still } from './helpers/stage';

/**
 * MEDIA-1 still for Global Quick Compare (v0.2.14).
 *
 * Three things about how this has to be driven:
 *
 *  - **The global shortcut cannot be pressed.** ⌘⇧D is an OS-level binding and
 *    Playwright's `keyboard.press` goes to a focused window, so the panel is opened
 *    through `quick.open()` — the same call the shortcut's handler makes. Registration
 *    is asserted in `e2e/regression/quick-compare.spec.ts`, where it belongs.
 *  - **The panel is a second `BrowserWindow`**, the same renderer at `#quick` rather
 *    than a second bundle, so this spec deals in two pages and the shot is of the
 *    panel's own page. `stage()` pins the *main* window's device pixel ratio; the
 *    panel needs the same override applied to its page or the asset would come out
 *    2× on a retina machine and 1× elsewhere.
 *  - **The clipboard watcher offers; it never fills.** Noticing what someone copied
 *    is not the same as taking it, so what the picture shows is the offer sitting
 *    there with the second slot still empty and Compare still disabled. Accepting it
 *    is the user's click, and it is asserted below without being photographed.
 */

const BEFORE = 'retries = 2\ntimeout = 30\n';
const AFTER = 'retries = 2\ntimeout = 45\n';

test('stills: the quick panel, with a copied change offered rather than taken', async () => {
  const harness = await stage();

  try {
    await waitForReady(harness);

    const copy = (text: string): Promise<void> =>
      harness.app.evaluate(({ clipboard }, value: string) => clipboard.writeText(value), text);

    // ---------- the watcher is opt-in, so turn it on the way Settings does ----------
    await harness.page.evaluate(() => window.twinscope.settings.write({ clipboardWatcher: true }));

    // Whatever is already on the clipboard when the panel opens is not something the
    // user just did: the first poll takes it as a baseline and offers nothing.
    await copy(BEFORE);

    await harness.page.evaluate(() => window.twinscope.quick.open());
    const panel: Page = await harness.app.waitForEvent('window', { timeout: 20_000 });
    await panel.waitForLoadState('domcontentloaded');
    await expect(panel.getByTestId('quick-panel')).toBeVisible();

    // `harness.errors` watches the main window only, and the subject of this shot is
    // rendered by the other one.
    const panelErrors: string[] = [];
    panel.on('console', (message) => {
      if (message.type() === 'error') panelErrors.push(`[error] ${message.text()}`);
    });
    panel.on('pageerror', (error) => panelErrors.push(`[pageerror] ${error.message}`));

    // ---------- pin the panel's pixel ratio: `stage()` only did the main window ----------
    const size = await panel.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
    }));
    const session = await panel.context().newCDPSession(panel);
    await session.send('Emulation.setDeviceMetricsOverride', {
      ...size,
      deviceScaleFactor: DEVICE_SCALE_FACTOR,
      mobile: false,
    });

    // With the watcher on, the panel drops the hint that tells you to turn it on.
    await expect(panel.getByTestId('quick-watch-hint')).toHaveCount(0);
    await expect(panel.getByTestId('quick-clipboard-offer')).toHaveCount(0);

    // ---------- Paste is the user's own action: it fills the first empty slot ----------
    await panel.getByTestId('quick-paste').click();
    await expect(panel.getByTestId('quick-slot-a')).toHaveAttribute('data-filled', 'true');

    // ---------- now the clipboard changes underneath, and the panel OFFERS ----------
    await copy(AFTER);
    const offer = panel.getByTestId('quick-clipboard-offer');
    await expect(offer).toBeVisible();
    await expect(offer).toContainText('Clipboard changed');
    // It describes the real clipboard, read through the cheap signature the watcher
    // polls — never through `clipboard.read`, which would spill an image to disk.
    const signature = await harness.page.evaluate(() => window.twinscope.clipboard.signature());
    await expect(offer).toContainText(`${signature.size} characters`);

    // The state the asset exists to show: offered, not taken.
    await expect(panel.getByTestId('quick-slot-b')).toHaveAttribute('data-filled', 'false');
    await expect(panel.getByTestId('quick-compare')).toBeDisabled();

    await still({ ...harness, page: panel }, 'quick-compare-panel', {
      clip: [panel.getByTestId('quick-panel')],
      pad: 0,
    });

    // ---------- and accepting it is one click, which is the other half of the rule ----------
    await offer.click();
    await expect(panel.getByTestId('quick-slot-b')).toHaveAttribute('data-filled', 'true');
    await expect(panel.getByTestId('quick-detected')).toContainText('Text diff');

    expect(harness.errors, `errors:\n${harness.errors.join('\n')}`).toEqual([]);
    expect(panelErrors, `panel errors:\n${panelErrors.join('\n')}`).toEqual([]);
  } finally {
    await harness.close();
  }
});
