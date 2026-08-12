import { expect, test } from '@playwright/test';
import { copyFixture, freshWorkDir } from './helpers/fixtures';
import { openPair, stage, still } from './helpers/stage';

/**
 * MEDIA-1 stills for the text engine, plus the two chassis crops (the summary
 * strip and the export menu) that are easiest to photograph here.
 *
 * The pair goes in through the real file picker rather than the clipboard, so the
 * inputs carry a `.ts` extension and syntax highlighting has a language to work
 * with — a clipboard paste has no name and renders plain.
 */
test('stills: text diff, view modes, highlighting, toolbar, export menu', async () => {
  const harness = await stage();
  const dir = freshWorkDir('text');

  try {
    const pair = {
      before: copyFixture('text/client.ts', dir),
      after: copyFixture('text/client.next.ts', dir),
    };

    await openPair(harness, pair);
    await harness.page.getByTestId('compare-button').click();

    const diff = harness.page.getByTestId('text-diff');
    await expect(diff).toBeVisible();

    // Grammars and themes are dynamic imports, so the colour arrives a tick
    // after the rows do. Shooting before it lands photographs a plain diff.
    await expect(diff.locator('.dd-dtext span[style*="color"]').first()).toBeVisible();
    await expect(diff.locator('.dd-word').first()).toBeVisible();

    await still(harness, 'text-side-by-side', { statusBar: false });
    await still(harness, 'summary-strip', { clip: ['summary-strip'], pad: 10 });
    await still(harness, 'text-toggles', { clip: ['workspace-toolbar'], pad: 8 });

    // A closer crop for highlighting: the first rows carry imports, an interface
    // and the changed literals, which is where the token colours are.
    const rows = diff.locator('.dd-drow');
    await still(harness, 'text-highlighting', {
      clip: [rows.first(), rows.nth(13)],
      pad: 6,
    });

    await harness.page.getByRole('tab', { name: 'Unified' }).click();
    await expect(diff).toHaveAttribute('data-mode', 'unified');
    await still(harness, 'text-unified', { statusBar: false });

    await harness.page.getByRole('tab', { name: 'Inline' }).click();
    await expect(diff).toHaveAttribute('data-mode', 'inline');
    await still(harness, 'text-inline', { statusBar: false });

    await harness.page.getByRole('tab', { name: 'Side-by-side' }).click();

    // The export menu, with its trigger in frame so the crop explains itself.
    await harness.page.getByTestId('export-button').click();
    const menu = harness.page.getByTestId('export-menu');
    await expect(menu).toBeVisible();
    await still(harness, 'export-menu', {
      clip: [harness.page.getByTestId('export-button'), menu],
      pad: 14,
    });
    await harness.page.keyboard.press('Escape');

    expect(harness.errors, `errors:\n${harness.errors.join('\n')}`).toEqual([]);
  } finally {
    await harness.close();
  }
});
