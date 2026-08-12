import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { deflateSync } from 'node:zlib';
import { expect, test } from '@playwright/test';
import { launchApp } from '../helpers/launch';
import { pasteInput, openPalette } from '../helpers/seed';

/** Minimal RGBA PNG, same approach as the image regression spec. */
function png(w: number, h: number, paint: (x: number, y: number) => number[]): Buffer {
  const raw = Buffer.alloc(h * (w * 4 + 1));
  let at = 0;
  for (let y = 0; y < h; y += 1) {
    raw[at++] = 0;
    for (let x = 0; x < w; x += 1) {
      const p = paint(x, y);
      raw[at++] = p[0]!;
      raw[at++] = p[1]!;
      raw[at++] = p[2]!;
      raw[at++] = p[3]!;
    }
  }
  const T = Array.from({ length: 256 }, (_, i) => {
    let v = i;
    for (let b = 0; b < 8; b += 1) v = v & 1 ? 0xedb88320 ^ (v >>> 1) : v >>> 1;
    return v >>> 0;
  });
  const crc = (b: Buffer) => {
    let c = 0xffffffff;
    for (const x of b) c = (T[(c ^ x) & 0xff] as number) ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (t: string, b: Buffer) => {
    const l = Buffer.alloc(4);
    l.writeUInt32BE(b.length);
    const ty = Buffer.concat([Buffer.from(t, 'ascii'), b]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(ty));
    return Buffer.concat([l, ty, c]);
  };
  const hdr = Buffer.alloc(13);
  hdr.writeUInt32BE(w, 0);
  hdr.writeUInt32BE(h, 4);
  hdr[8] = 8;
  hdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', hdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * REGRESSION — the whole product, in one app instance.
 *
 * Every other spec launches a fresh app for one area. This one does not, and
 * that is the point: the bugs it can catch are the ones that only exist *between*
 * features — a store that does not reset when you switch engines, a toolbar slot
 * two views both claim, change navigation left pointing at the previous result.
 *
 * The search store is the clearest example. The text view registers matches and
 * gets an `n/m` badge; JSON and folder use the same box as a filter and must
 * not. Only a session that visits both proves the handover works.
 */
test('full loop: every engine, history, export and palette in one session', async () => {
  const harness = await launchApp();
  const dir = await mkdtemp(join(tmpdir(), 'twinscope-final-'));
  const stub = async (paths: string[]) =>
    harness.app.evaluate(({ dialog }, p: string[]) => {
      let call = 0;
      dialog.showOpenDialog = () =>
        Promise.resolve({ canceled: false, filePaths: [p[call++] ?? p[0]!] });
    }, paths);

  try {
    const page = harness.page;

    // ============ 1. TEXT ============
    await pasteInput(harness, 'alpha one\nshared\nremoved', 'before');
    await pasteInput(harness, 'beta one\nshared\nadded line', 'after');
    await page.getByTestId('compare-button').click();
    await expect(page.getByTestId('text-diff')).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('workspace-search').fill('shared');
    await expect(page.getByTestId('search-count')).toContainText('/ 1');
    await page.getByTestId('workspace-search').fill('');
    await page.getByRole('button', { name: 'Ignore case' }).click();
    await expect(page.getByTestId('summary-strip')).toBeVisible();
    console.log('STEP 1 text: ok');

    // ============ 2. JSON (search store must reset between views) ============
    await page.getByTestId('back-button').click();
    await pasteInput(harness, '{"a":1,"b":{"c":2}}', 'before');
    await pasteInput(harness, '{"a":9,"b":{"c":2}}', 'after');
    await page.getByTestId('compare-button').click();
    await expect(page.getByTestId('json-tree')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('search-count')).toHaveCount(0); // filter view: no n/m badge
    await expect(page.getByTestId('json-options')).toBeVisible();
    console.log('STEP 2 json: ok');

    // ============ 3. FOLDER + drill-in + breadcrumb ============
    await page.getByTestId('back-button').click();
    const fa = join(dir, 'A');
    const fb = join(dir, 'B');
    for (const [root, body] of [
      [fa, 'v1'],
      [fb, 'v2'],
    ] as const) {
      await mkdir(dirname(join(root, 'src', 'x.ts')), { recursive: true });
      await writeFile(join(root, 'src', 'x.ts'), `export const x = "${body}";\n`);
    }
    await stub([fa, fb]);
    await page.getByTestId('pick-folder-before').click();
    await page.getByTestId('pick-folder-after').click();
    await page.getByTestId('compare-button').click();
    await expect(page.getByTestId('folder-tree')).toBeVisible({ timeout: 20_000 });
    await page.locator('[data-path="src/x.ts"]').dblclick();
    await expect(page.getByTestId('text-diff')).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('breadcrumb-back').click();
    await expect(page.getByTestId('folder-tree')).toBeVisible();
    console.log('STEP 3 folder + drill-in: ok');

    // ============ 4. IMAGE ============
    await page.getByTestId('back-button').click();
    const ia = join(dir, 'a.png');
    const ib = join(dir, 'b.png');
    await writeFile(
      ia,
      png(80, 80, () => [20, 20, 30, 255]),
    );
    await writeFile(
      ib,
      png(80, 80, (x, y) => (x < 30 && y < 30 ? [160, 160, 160, 255] : [20, 20, 30, 255])),
    );
    await stub([ia, ib]);
    await page.getByTestId('pick-file-before').click();
    await page.getByTestId('pick-file-after').click();
    await page.getByTestId('compare-button').click();
    await expect(page.getByTestId('image-stage')).toBeVisible({ timeout: 20_000 });
    await page.getByRole('tab', { name: 'Difference' }).click();
    await expect(page.getByTestId('pane-diff')).toBeVisible();
    console.log('STEP 4 image: ok');

    // ============ 5. BINARY ============
    await page.getByTestId('back-button').click();
    const ba = join(dir, 'a.bin');
    const bb = join(dir, 'b.bin');
    await writeFile(ba, Buffer.from([0, 1, 2, 3, 0, 255]));
    await writeFile(bb, Buffer.from([0, 1, 2, 9, 0, 255]));
    await stub([ba, bb]);
    await page.getByTestId('pick-file-before').click();
    await page.getByTestId('pick-file-after').click();
    await page.getByTestId('compare-button').click();
    await expect(page.getByTestId('binary-view')).toBeVisible({ timeout: 20_000 });
    console.log('STEP 5 binary: ok');

    // ============ 6. EXPORT to disk ============
    const out = join(dir, 'report.html');
    await harness.app.evaluate(({ dialog }, target: string) => {
      dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath: target });
    }, out);
    await page.getByTestId('export-button').click();
    await page.getByTestId('export-html').click();
    await expect
      .poll(async () => (await readFile(out, 'utf8').catch(() => '')).length, { timeout: 20_000 })
      .toBeGreaterThan(500);
    console.log('STEP 6 export html:', (await readFile(out, 'utf8')).length, 'bytes');

    // ============ 7. HISTORY ============
    await page.getByTestId('back-button').click();
    await page.keyboard.press('Meta+2');
    await expect(page.getByTestId('screen-history')).toBeVisible();
    // Rows are keyed by database id, so count the row elements themselves.
    const rows = await page
      .locator('[data-testid^="history-"]:not([data-testid$="search"]):not([data-testid$="empty"])')
      .count();
    console.log('STEP 7 history rows:', rows);
    await expect(page.getByTestId('history-empty')).toHaveCount(0);
    expect(rows).toBeGreaterThanOrEqual(5);

    // ============ 8. PALETTE + THEME ============
    await openPalette(harness);
    await page.keyboard.press('Escape');
    const before = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    await page.getByTestId('theme-toggle').click();
    const after = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    expect(after).not.toBe(before);
    console.log('STEP 8 palette + theme:', before, '->', after);

    expect(harness.errors, `console errors:\n${harness.errors.join('\n')}`).toEqual([]);
  } finally {
    await harness.close();
    await rm(dir, { recursive: true, force: true });
  }
});
