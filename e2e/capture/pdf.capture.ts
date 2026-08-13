import { expect, test } from '@playwright/test';
import { copyFixture, freshWorkDir } from './helpers/fixtures';
import { openPair, stage, still } from './helpers/stage';

/**
 * MEDIA-1 still for the PDF engine (v0.3.3).
 *
 * The point of the picture is that **pages pair by content**: the AFTER document
 * has a cover page inserted at the front, so page 1 of the baseline is page 2 of
 * the revision and every later page shifts by one. A comparison that paired by
 * number would report every page changed; this one reports the cover as added, the
 * two pages that really moved, and leaves the untouched page out of the list.
 *
 * The fixtures are committed PDFs (`fixtures/pdf/contract.*.pdf.txt`) rather than
 * generated, so the still cannot change because a generator did — and they go
 * through the real pdfjs in the engine worker, not a stub.
 */
test('stills: pdf pages paired by content, metadata, a rotated page', async () => {
  const harness = await stage();
  expect(harness.target).toBe('app');
  const dir = freshWorkDir('pdf');

  try {
    await openPair(harness, {
      before: copyFixture('pdf/contract.before.pdf', dir),
      after: copyFixture('pdf/contract.after.pdf', dir),
    });
    // Without the PDF engine these two are `binary`, and the answer on screen
    // would be two hashes and "these files differ".
    await expect(harness.page.getByTestId('detected-bar')).toContainText('PDF diff');

    await harness.page.getByTestId('compare-button').click();

    const view = harness.page.getByTestId('pdf-view');
    await expect(view).toBeVisible({ timeout: 60_000 });

    const strip = harness.page.getByTestId('summary-strip');
    await expect(strip).toContainText('3 → 4 pages');
    await expect(strip).toContainText('＋1 added');
    await expect(strip).toContainText('－0 removed');
    // The definitions page is untouched *because* pages pair on content: two of
    // the three original pages changed, not all three.
    await expect(strip).toContainText('～2 modified');

    // The first changed page opens by default, and the amounts are marked at word
    // level by the same text engine the line diff uses.
    await expect(view).toContainText('within 30 days');
    await expect(view).toContainText('within 14 days');
    await expect(view.locator('.dd-word').first()).toBeVisible();

    // Metadata that differs is a table of its own; a field that did not change is
    // absent from it.
    const metadata = harness.page.getByTestId('pdf-metadata');
    await expect(metadata).toContainText('Title');
    await expect(metadata).toContainText('ACME Supply Agreement v3');
    await expect(metadata).not.toContainText('Producer');

    // The liability page keeps its text but turns landscape, which is a change a
    // text comparison alone would have missed.
    await expect(view).toContainText('595×842 → 842×595 pt');

    await still(harness, 'pdf-pages', { statusBar: false });

    // What the comparison did not do is on screen beside what it did.
    await expect(harness.page.getByTestId('normalize-notes')).toContainText(
      'Rendering pages to compare them visually',
    );

    expect(harness.errors, `errors:\n${harness.errors.join('\n')}`).toEqual([]);
  } finally {
    await harness.close();
  }
});
