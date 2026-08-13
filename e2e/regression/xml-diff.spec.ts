import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, test } from '@playwright/test';
import { launchApp, type Harness } from '../helpers/launch';

/**
 * REGRESSION — v0.2.4: the XML engine.
 *
 * Through the file picker, like the YAML spec, because `.xml` detection is the
 * point: before this feature two XML files were classified as `code` and got a
 * *line* diff. Only the native dialog is stubbed.
 */

const BEFORE = `<?xml version="1.0" encoding="UTF-8"?>
<catalog version="2">
  <book id="b1" lang="en">
    <title>Structure and Interpretation</title>
    <price currency="GBP">32.00</price>
  </book>
  <book id="b2" lang="en">
    <title>The Little Schemer</title>
    <price currency="GBP">18.50</price>
  </book>
</catalog>
`;

const AFTER = `<?xml version="1.0" encoding="UTF-8"?>
<catalog version="3">
  <book id="b1" lang="en-GB">
    <title>Structure and Interpretation</title>
    <price currency="GBP">34.00</price>
  </book>
  <book id="b2" lang="en">
    <title>The Little Schemer</title>
    <price currency="GBP">18.50</price>
  </book>
  <book id="b3" lang="en">
    <title>A New Book</title>
    <price currency="GBP">12.00</price>
  </book>
</catalog>
`;

async function stage(harness: Harness, files: Array<[string, string]>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'twinscope-xml-'));
  const paths: string[] = [];
  for (const [name, content] of files) {
    const path = join(root, name);
    await writeFile(path, content);
    paths.push(path);
  }

  await harness.app.evaluate(({ dialog }, queued: string[]) => {
    let call = 0;
    dialog.showOpenDialog = () =>
      Promise.resolve({ canceled: false, filePaths: [queued[call++] ?? queued[0]!] });
  }, paths);

  return root;
}

test('xml diff: attributes, a repeated child, and the JSON view reused', async () => {
  const harness = await launchApp();
  let root: string | null = null;

  try {
    root = await stage(harness, [
      ['catalog-before.xml', BEFORE],
      ['catalog-after.xml', AFTER],
    ]);

    await harness.page.getByTestId('pick-file-before').click();
    await harness.page.getByTestId('pick-file-after').click();

    // Detection, not an override — `.xml` used to read as `code`.
    await expect(harness.page.getByTestId('detected-bar')).toContainText('Structural XML diff');

    await harness.page.getByTestId('compare-button').click();

    const tree = harness.page.getByTestId('json-tree');
    await expect(tree).toBeVisible({ timeout: 20_000 });

    const strip = harness.page.getByTestId('summary-strip');
    // b3 is added; version, b1's lang and b1's price changed.
    await expect(strip).toContainText('＋1 added');
    await expect(strip).toContainText('～3 modified');
    // The added child is an *addition*, not a type change: this is what forcing
    // every element into a list buys.
    await expect(strip).not.toContainText('type change');
    // Attributes get their own count, which answers "structure or just an attribute?"
    await expect(strip).toContainText('2 attributes');

    // ---------- an attribute and a text change are separate rows ----------
    // Attributes are `@name` keys and text is `#text`, so a changed attribute and
    // a changed value are two rows rather than one "the element changed".
    await expect(tree).toContainText('@version');
    await expect(tree).toContainText('@lang');
    await expect(tree).toContainText('#text');
    // The unchanged attribute is not a row in the default only-changes view.
    await expect(tree).not.toContainText('@currency');

    await harness.screenshot('xml-tree-dark');

    // ---------- the notes explain both parsing decisions (Rule 3) ----------
    await harness.page.getByRole('tab', { name: 'Tree' }).click();
    const explain = harness.page.getByTestId('json-explain');
    await expect(explain).toContainText('compared as a list');
    await expect(explain).toContainText('compared as text');

    expect(harness.errors, `errors:\n${harness.errors.join('\n')}`).toEqual([]);
  } finally {
    await harness.close();
    if (root !== null) await rm(root, { recursive: true, force: true });
  }
});

test('xml diff: reformatting changes nothing', async () => {
  const harness = await launchApp();
  let root: string | null = null;

  try {
    root = await stage(harness, [
      ['a.xml', '<steps><step>build</step><step>test</step></steps>'],
      ['b.xml', '<steps>\n  <step>build</step>\n  <step>test</step>\n</steps>\n'],
    ]);

    await harness.page.getByTestId('pick-file-before').click();
    await harness.page.getByTestId('pick-file-after').click();
    await harness.page.getByTestId('compare-button').click();

    await expect(harness.page.getByTestId('json-tree')).toBeVisible({ timeout: 20_000 });
    const strip = harness.page.getByTestId('summary-strip');
    // Indentation is presentation; the two documents are the same.
    await expect(strip).toContainText('＋0 added');
    await expect(strip).toContainText('～0 modified');

    expect(harness.errors, `errors:\n${harness.errors.join('\n')}`).toEqual([]);
  } finally {
    await harness.close();
    if (root !== null) await rm(root, { recursive: true, force: true });
  }
});

test('xml diff: reordering children IS a change, unlike a JSON array', async () => {
  const harness = await launchApp();
  let root: string | null = null;

  try {
    // `<step>` elements in a different order describe a different process, which is
    // why this engine runs the shared core with `ignoreArrayOrder` inverted.
    root = await stage(harness, [
      ['a.xml', '<steps><step>build</step><step>test</step></steps>'],
      ['c.xml', '<steps><step>test</step><step>build</step></steps>'],
    ]);

    await harness.page.getByTestId('pick-file-before').click();
    await harness.page.getByTestId('pick-file-after').click();
    await harness.page.getByTestId('compare-button').click();

    await expect(harness.page.getByTestId('json-tree')).toBeVisible({ timeout: 20_000 });
    await expect(harness.page.getByTestId('summary-strip')).not.toContainText('～0 modified');

    expect(harness.errors, `errors:\n${harness.errors.join('\n')}`).toEqual([]);
  } finally {
    await harness.close();
    if (root !== null) await rm(root, { recursive: true, force: true });
  }
});

test('xml diff: a malformed document names the line and offers text', async () => {
  const harness = await launchApp();
  let root: string | null = null;

  try {
    root = await stage(harness, [
      ['broken.xml', '<catalog>\n  <book>\n    <title>Unclosed\n  </book>\n</catalog>\n'],
      ['ok.xml', '<catalog><book><title>Fine</title></book></catalog>'],
    ]);

    await harness.page.getByTestId('pick-file-before').click();
    await harness.page.getByTestId('pick-file-after').click();
    await harness.page.getByTestId('compare-button').click();

    const error = harness.page.getByTestId('job-error');
    await expect(error).toBeVisible({ timeout: 20_000 });
    await expect(error).toContainText('is not valid XML');
    await expect(error).toContainText('line');

    await harness.page.getByTestId('error-fallback').click();
    await expect(harness.page.getByTestId('text-diff')).toBeVisible({ timeout: 20_000 });

    expect(harness.errors, `errors:\n${harness.errors.join('\n')}`).toEqual([]);
  } finally {
    await harness.close();
    if (root !== null) await rm(root, { recursive: true, force: true });
  }
});
