import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, test } from '@playwright/test';
import { launchApp } from '../helpers/launch';
import { pasteInput } from '../helpers/seed';

/**
 * REGRESSION — MVP-11: the edges.
 *
 * Everything here is a case that used to produce something embarrassing: a
 * binary file rendered as mojibake, a UTF-16 file read as NULs, an identical
 * pair shown as an empty diff with no explanation.
 */

async function withFiles<T>(run: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'twinscope-hard-'));
  try {
    return await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Stubs the picker for one launch: first call gets A, second gets B. */
async function stubPicker(
  harness: Awaited<ReturnType<typeof launchApp>>,
  paths: string[],
): Promise<void> {
  await harness.app.evaluate(({ dialog }, files: string[]) => {
    let call = 0;
    dialog.showOpenDialog = () =>
      Promise.resolve({ canceled: false, filePaths: [files[call++] ?? files[0]!] });
  }, paths);
}

test('hardening: binary pairs get a verdict, not a garbled diff', async () => {
  const harness = await launchApp();

  try {
    await withFiles(async (dir) => {
      const before = join(dir, 'app.bin');
      const after = join(dir, 'app.next.bin');
      // NUL bytes make these binary; the second is one byte longer.
      await writeFile(before, Buffer.from([0, 1, 2, 3, 0, 255]));
      await writeFile(after, Buffer.from([0, 1, 2, 3, 0, 255, 7]));

      await stubPicker(harness, [before, after]);
      await harness.page.getByTestId('pick-file-before').click();
      await harness.page.getByTestId('pick-file-after').click();

      await expect(harness.page.getByTestId('detected-bar')).toContainText('Binary comparison');
      await harness.page.getByTestId('compare-button').click();

      const view = harness.page.getByTestId('binary-view');
      await expect(view).toBeVisible({ timeout: 20_000 });
      await expect(view).toContainText('These files are different');
      await expect(view).toContainText('1 B larger');
      // No diff rows anywhere: that is the whole point.
      await expect(harness.page.locator('.dd-drow')).toHaveCount(0);

      await harness.screenshot('binary-verdict');
    });

    expect(harness.errors, `errors:\n${harness.errors.join('\n')}`).toEqual([]);
  } finally {
    await harness.close();
  }
});

test('hardening: identical inputs, encodings and empty files are explained', async () => {
  const harness = await launchApp();

  try {
    await withFiles(async (dir) => {
      // ---------- the same file on both sides ----------
      const same = join(dir, 'same.txt');
      await writeFile(same, 'one\ntwo\n');
      await stubPicker(harness, [same, same]);
      await harness.page.getByTestId('pick-file-before').click();
      await harness.page.getByTestId('pick-file-after').click();
      await harness.page.getByTestId('compare-button').click();

      await expect(harness.page.getByTestId('summary-strip')).toContainText('0 changes', {
        timeout: 20_000,
      });
      await expect(harness.page.getByTestId('text-diff')).toBeVisible();
      await harness.page.getByTestId('back-button').click();

      // ---------- a UTF-16 file is text, not binary ----------
      const utf16Path = join(dir, 'utf16.txt');
      const utf8Path = join(dir, 'utf8.txt');
      // BOM + "héllo\n" in UTF-16 LE.
      const text = 'héllo\n';
      const bytes = Buffer.alloc(2 + text.length * 2);
      bytes.writeUInt16LE(0xfeff, 0);
      for (let index = 0; index < text.length; index += 1) {
        bytes.writeUInt16LE(text.charCodeAt(index), 2 + index * 2);
      }
      await writeFile(utf16Path, bytes);
      await writeFile(utf8Path, 'héllo world\n');

      await stubPicker(harness, [utf16Path, utf8Path]);
      await harness.page.getByTestId('pick-file-before').click();
      await harness.page.getByTestId('pick-file-after').click();
      await expect(harness.page.getByTestId('detected-bar')).toContainText('Text diff');

      await harness.page.getByTestId('compare-button').click();
      const diff = harness.page.getByTestId('text-diff');
      await expect(diff).toBeVisible({ timeout: 20_000 });
      // Decoded, not mojibake — and the status bar says how it was read.
      await expect(diff).toContainText('héllo');
      await expect(harness.page.getByTestId('status-detail')).toContainText('UTF-16 LE');
      await harness.page.getByTestId('back-button').click();

      // ---------- two empty files say so ----------
      const emptyA = join(dir, 'empty-a.txt');
      const emptyB = join(dir, 'empty-b.txt');
      await writeFile(emptyA, '');
      await writeFile(emptyB, '');

      await stubPicker(harness, [emptyA, emptyB]);
      await harness.page.getByTestId('pick-file-before').click();
      await harness.page.getByTestId('pick-file-after').click();
      await harness.page.getByTestId('compare-button').click();
      await expect(harness.page.getByTestId('summary-strip')).toContainText('0 changes', {
        timeout: 20_000,
      });
    });

    expect(harness.errors, `errors:\n${harness.errors.join('\n')}`).toEqual([]);
  } finally {
    await harness.close();
  }
});

test('hardening: a deleted input fails with a readable message, not a stack trace', async () => {
  const harness = await launchApp();

  try {
    await withFiles(async (dir) => {
      const before = join(dir, 'here.txt');
      const after = join(dir, 'gone.txt');
      await writeFile(before, 'a\n');
      // Large enough that the payload carries a path rather than inlined text,
      // so the engine host is the one that discovers it is missing.
      await writeFile(after, 'b\n'.repeat(6_000_000));

      await stubPicker(harness, [before, after]);
      await harness.page.getByTestId('pick-file-before').click();
      await harness.page.getByTestId('pick-file-after').click();
      await rm(after);

      // 12 MB of text used to trip the heavy-input confirmation here. Since v0.2.8
      // a pair this size on disk is routed to large-file mode, which is *for* these
      // sizes — warning that it may take a few seconds would be warning about the
      // thing that stopped being slow. The confirmation still guards the engines
      // that are slow at this size; `large-file.spec.ts` covers it by forcing one.
      await harness.page.getByTestId('compare-button').click();
      await expect(harness.page.getByTestId('confirm-heavy')).toHaveCount(0);

      const panel = harness.page.getByTestId('job-error');
      await expect(panel).toBeVisible({ timeout: 20_000 });
      await expect(panel).toContainText('Comparison failed');
      await expect(panel).toContainText('gone.txt');
      // Recovery is offered, and the details are copyable.
      await expect(harness.page.getByTestId('copy-details')).toBeVisible();
    });
  } finally {
    await harness.close();
  }
});

test('hardening: memory returns to baseline after ten comparisons', async () => {
  const harness = await launchApp();

  try {
    const heap = async (): Promise<number> =>
      harness.page.evaluate(() => {
        const memory = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
        return memory?.usedJSHeapSize ?? 0;
      });

    const body = Array.from({ length: 400 }, (_, index) => `line ${index}`).join('\n');
    await pasteInput(harness, `alpha\n${body}`, 'before');
    await pasteInput(harness, `beta\n${body}`, 'after');
    await harness.page.getByTestId('compare-button').click();
    await expect(harness.page.getByTestId('text-diff')).toBeVisible({ timeout: 20_000 });

    const baseline = await heap();

    for (let run = 0; run < 10; run += 1) {
      await harness.page.getByTestId('back-button').click();
      await pasteInput(harness, `alpha ${run}\n${body}`, 'before');
      await pasteInput(harness, `beta ${run}\n${body}`, 'after');
      await harness.page.getByTestId('compare-button').click();
      await expect(harness.page.getByTestId('text-diff')).toBeVisible({ timeout: 20_000 });
    }

    const after = await heap();

    // The store keeps exactly one result, so ten more comparisons must not
    // multiply the heap. Generous bound: this catches a leak, not a wobble.
    if (baseline > 0) {
      expect(after).toBeLessThan(baseline * 2.5);
    }

    expect(harness.errors, `errors:\n${harness.errors.join('\n')}`).toEqual([]);
  } finally {
    await harness.close();
  }
});
