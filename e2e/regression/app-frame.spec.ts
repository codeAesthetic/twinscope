import { expect, test } from '@playwright/test';
import { launchApp } from '../helpers/launch';
import { seedComparison } from '../helpers/seed';

/**
 * REGRESSION — HOME-1 / HOME-4: the app frame and screen shells.
 *
 * Guards the chrome every screen renders inside. Most of these are things a
 * screenshot cannot show (drag regions, sticky headers, token resolution), and
 * all of them are cheap.
 */
test('app frame: chrome, navigation and themes', async () => {
  const harness = await launchApp();

  try {
    // --- chrome present ---
    await expect(harness.page.getByTestId('titlebar')).toBeVisible();
    await expect(harness.page.getByTestId('sidebar')).toBeVisible();
    await expect(harness.page.getByTestId('statusbar')).toBeVisible();
    await expect(harness.page.getByTestId('privacy-badge')).toContainText('Local only');

    // --- the titlebar drags the window; its buttons must not ---
    const regions = await harness.page.evaluate(() => {
      const styleOf = (selector: string): string =>
        getComputedStyle(document.querySelector(selector)!).getPropertyValue('-webkit-app-region');
      return {
        bar: styleOf('[data-testid="titlebar"]'),
        button: styleOf('[data-testid="theme-toggle"]'),
        padding: getComputedStyle(document.querySelector('[data-testid="titlebar"]')!).paddingLeft,
      };
    });
    expect(regions.bar).toBe('drag');
    expect(regions.button).toBe('no-drag');
    if (harness.platform === 'darwin') expect(regions.padding).toBe('84px');

    // --- navigation, by mouse and by keyboard ---
    await expect(harness.page.getByTestId('nav-compare')).toHaveAttribute('aria-current', 'page');
    await harness.page.getByTestId('nav-history').click();
    await expect(harness.page.getByTestId('screen-history')).toBeVisible();
    await harness.page.getByTestId('nav-settings').click();
    await expect(harness.page.getByTestId('screen-settings')).toBeVisible();
    await harness.page.getByTestId('nav-compare').focus();
    await harness.page.keyboard.press('Enter');
    await expect(harness.page.getByTestId('screen-compare')).toBeVisible();

    // Projects became a real destination at v0.2.9, and stopped saying `soon`.
    await harness.page.getByTestId('nav-projects').click();
    await expect(harness.page.getByTestId('screen-projects')).toBeVisible();
    await expect(harness.page.getByTestId('nav-projects')).not.toContainText('soon');
    await harness.page.getByTestId('nav-compare').click();

    // --- history: buckets stick, star states differ ---
    // Rows are live since MVP-8, so the spec makes its own.
    await seedComparison(harness, 'alpha\nshared', 'beta\nshared');
    await seedComparison(harness, 'gamma\nshared', 'delta\nshared');

    await harness.page.getByTestId('nav-history').click();
    await expect(harness.page.locator('.dd-hgroup')).toHaveCount(1);
    await expect(harness.page.locator('.dd-hitem')).toHaveCount(2);

    // One starred, one not, so both states are on screen to compare.
    await harness.page.locator('[data-testid^="star-"]').first().click();
    await expect(harness.page.locator('.dd-hitem-star[data-starred="true"]')).toHaveCount(1);

    const history = await harness.page.evaluate(() => ({
      sticky: getComputedStyle(document.querySelector('.dd-hgroup')!).position,
      starOn: getComputedStyle(document.querySelector('.dd-hitem-star[data-starred="true"]')!)
        .color,
      starOff: getComputedStyle(document.querySelector('.dd-hitem-star[data-starred="false"]')!)
        .color,
    }));
    expect(history.sticky).toBe('sticky');
    expect(history.starOn).not.toBe(history.starOff);

    // --- settings: four groups, the generated shortcut grid, live theme switch ---
    await harness.page.getByTestId('nav-settings').click();
    await expect(harness.page.locator('[data-testid="screen-settings"] h2')).toHaveCount(4);
    // Generated from lib/shortcuts.ts since MVP-10, so this counts the registry
    // rather than a hand-written list.
    // 17 since v0.2.9: ⌘3 for Projects and ⌘S to save a comparison.
    await expect(harness.page.getByTestId('shortcuts-grid').locator('.dd-scrow')).toHaveCount(17);

    await expect(harness.page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await harness.page.getByRole('tab', { name: 'Light' }).click();
    await expect(harness.page.locator('html')).toHaveAttribute('data-theme', 'light');

    // Tokens must actually change, not just the attribute.
    const lightBg = await harness.page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(),
    );
    expect(lightBg).toBe('#eceef2');

    await harness.page.getByRole('tab', { name: 'Dark' }).click();
    await expect(harness.page.locator('html')).toHaveAttribute('data-theme', 'dark');

    // --- the update switch must not promise what the app does not do ---
    // It once defaulted to ON and read "signed releases, verified before install":
    // nothing checked anything and the app is unsigned by decision. v0.2.13 made the
    // check real, so what has to hold now is that it is a real control which starts
    // OFF, and that the row says what turning it on does. The behaviour itself is
    // `update.spec.ts`; this is the frame's own assertion that no switch lies.
    await harness.page.getByTestId('nav-settings').click();
    const updates = harness.page.getByRole('switch', { name: 'Check for updates' });
    await expect(updates).toBeEnabled();
    await expect(updates).toHaveAttribute('aria-checked', 'false');
    await expect(harness.page.getByTestId('screen-settings')).toContainText(
      'The only network call TwinScope makes',
    );
    // Nothing is downloaded or installed — the claim the unsigned build depends on.
    await expect(harness.page.getByTestId('screen-settings')).toContainText(
      'Nothing is downloaded or installed',
    );

    expect(harness.errors, `errors:\n${harness.errors.join('\n')}`).toEqual([]);
  } finally {
    await harness.close();
  }
});
