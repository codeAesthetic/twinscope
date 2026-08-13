import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, test } from '@playwright/test';
import { launchApp, type Harness } from '../helpers/launch';
import { makePdf } from '../helpers/pdf';

/**
 * REGRESSION — v0.3.3: PDF comparison.
 *
 * The engine's page alignment is unit-tested against a fake reader; what this proves is
 * the whole path with a **real PDF and the real pdfjs**: two `.pdf` files are detected
 * as documents rather than as binaries, pages pair by content so an inserted page does
 * not shift the rest, and the view opens on the page that changed.
 */

async function stage(harness: Harness, files: Array<[string, Buffer]>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'twinscope-pdf-'));
  const paths: string[] = [];
  for (const [name, content] of files) {
    const path = join(root, name);
    await writeFile(path, content);
    paths.push(path);
  }
  await harness.app.evaluate(({ dialog }, queued: string[]) => {
    let call = 0;
    dialog.showOpenDialog = () =>
      Promise.resolve({ canceled: false, filePaths: [queued[call++ % queued.length] as string] });
  }, paths);
  return root;
}

test('pdf diff: pages pair by content, and an inserted page shifts nothing after it', async () => {
  const harness = await launchApp();
  let root: string | null = null;

  try {
    const before = makePdf(
      [
        { lines: ['Invoice 1042', 'Acme Ltd', 'Total: 240.00'] },
        { lines: ['Terms and conditions', 'Payment within 30 days'] },
      ],
      { Title: 'Invoice 1042', Producer: 'TwinScope spec' },
    );

    const after = makePdf(
      [
        // A new cover page at the front: every later page shifts by one.
        { lines: ['DRAFT — not for circulation'] },
        { lines: ['Invoice 1042', 'Acme Ltd', 'Total: 260.00'] },
        { lines: ['Terms and conditions', 'Payment within 30 days'] },
      ],
      { Title: 'Invoice 1042 (draft)', Producer: 'TwinScope spec' },
    );

    root = await stage(harness, [
      ['invoice.before.pdf', before],
      ['invoice.after.pdf', after],
    ]);

    await harness.page.getByTestId('pick-file-before').click();
    await harness.page.getByTestId('pick-file-after').click();
    // Without a PDF engine these two are `binary`, and the answer would be "these
    // files differ" and two hashes.
    await expect(harness.page.getByTestId('detected-bar')).toContainText('PDF diff');

    await harness.page.getByTestId('compare-button').click();
    const view = harness.page.getByTestId('pdf-view');
    await expect(view).toBeVisible({ timeout: 30_000 });

    const strip = harness.page.getByTestId('summary-strip');
    // One page added, one page's text changed, and the terms page untouched — which is
    // only true because pages pair on content rather than on number.
    await expect(strip).toContainText('＋1 added');
    await expect(strip).toContainText('－0 removed');
    await expect(strip).toContainText('～1 modified');
    await expect(strip).toContainText('2 → 3 pages');

    // The changed page shows the line, with the amount marked at word level.
    await expect(view).toContainText('240.00');
    await expect(view).toContainText('260.00');
    await expect(view.locator('.dd-word').first()).toBeVisible();

    // The new cover page is its own row, and the terms page is not in the changed list.
    await expect(view).toContainText('added');
    await expect(view).not.toContainText('Payment within 30 days');

    // Metadata that differs is a table of its own.
    const metadata = harness.page.getByTestId('pdf-metadata');
    await expect(metadata).toContainText('Title');
    await expect(metadata).toContainText('Invoice 1042 (draft)');
    // …and a field that did not change is absent from it.
    await expect(metadata).not.toContainText('Producer');

    await harness.screenshot('pdf-pages');

    // The visual half is not pretended: the notes say what was not done.
    await expect(harness.page.getByTestId('normalize-notes')).toContainText(
      'Rendering pages to compare them visually',
    );

    expect(harness.errors, `errors:\n${harness.errors.join('\n')}`).toEqual([]);
  } finally {
    if (root !== null) await rm(root, { recursive: true, force: true });
    await harness.close();
  }
});

test('pdf diff: two identical documents say so, and a page with no text says that', async () => {
  const harness = await launchApp();
  let root: string | null = null;

  try {
    const same = makePdf([{ lines: ['One', 'Two'] }]);
    // A page with a content stream that draws no text: a scan, as far as extraction
    // is concerned.
    const blank = makePdf([{ lines: [] }]);

    root = await stage(harness, [
      ['same.a.pdf', same],
      ['same.b.pdf', same],
      ['blank.pdf', blank],
    ]);

    await harness.page.getByTestId('pick-file-before').click();
    await harness.page.getByTestId('pick-file-after').click();
    await harness.page.getByTestId('compare-button').click();

    await expect(harness.page.getByTestId('pdf-view')).toBeVisible({ timeout: 30_000 });
    await expect(harness.page.getByTestId('pdf-empty')).toContainText('same text');

    expect(harness.errors, `errors:\n${harness.errors.join('\n')}`).toEqual([]);
  } finally {
    if (root !== null) await rm(root, { recursive: true, force: true });
    await harness.close();
  }
});
