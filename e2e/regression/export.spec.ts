import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, test } from '@playwright/test';
import { launchApp } from '../helpers/launch';
import { pasteInput } from '../helpers/seed';

/**
 * REGRESSION — MVP-9: export.
 *
 * The save dialog is stubbed to a known path, but everything else is real: the
 * renderer collects the result, main renders it with the shared renderers, and
 * the file is read back off disk and checked.
 */
test('export: HTML and Markdown reports, and a patch on the clipboard', async () => {
  const harness = await launchApp();
  const output = await mkdtemp(join(tmpdir(), 'devdiff-export-'));

  try {
    await pasteInput(harness, 'const timeout = 5000;\nshared line\n', 'before');
    await pasteInput(harness, 'const timeout = 8000;\nshared line\n', 'after');
    await harness.page.getByTestId('compare-button').click();
    await expect(harness.page.getByTestId('text-diff')).toBeVisible({ timeout: 20_000 });

    const stubSave = async (file: string): Promise<void> => {
      await harness.app.evaluate(({ dialog }, path: string) => {
        dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath: path });
      }, file);
    };

    // ---------- HTML: a single file that opens anywhere ----------
    const htmlPath = join(output, 'report.html');
    await stubSave(htmlPath);
    await harness.page.getByTestId('export-button').click();
    await harness.page.getByTestId('export-html').click();
    await expect(harness.page.getByTestId('export-toast')).toContainText('Report saved');

    const html = await readFile(htmlPath, 'utf8');
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('const timeout = ');
    // Self-contained: no scripts, no remote anything.
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/https?:\/\//);
    // The internal word-mark encoding must never reach a reader.
    expect(html).not.toContain('⟦');

    // ---------- Markdown: a fenced diff for a pull request ----------
    const mdPath = join(output, 'report.md');
    await stubSave(mdPath);
    await harness.page.getByTestId('export-button').click();
    await harness.page.getByTestId('export-md').click();
    await expect(harness.page.getByTestId('export-toast')).toContainText('Report saved');

    const markdown = await readFile(mdPath, 'utf8');
    expect(markdown).toContain('```diff');
    expect(markdown).toContain('-const timeout = 5000;');
    expect(markdown).toContain('+const timeout = 8000;');
    expect(markdown).toContain('1 change');

    // ---------- ⌘⇧E repeats whatever was exported last ----------
    const repeatPath = join(output, 'repeat.md');
    await stubSave(repeatPath);
    await harness.page.keyboard.press('Meta+Shift+E');
    await expect(harness.page.getByTestId('export-toast')).toContainText('Report saved');
    expect(await readFile(repeatPath, 'utf8')).toContain('```diff');

    // ---------- the patch goes to the clipboard, not to a file ----------
    await harness.page.getByTestId('export-button').click();
    await harness.page.getByTestId('export-patch').click();
    await expect(harness.page.getByTestId('export-toast')).toContainText('clipboard');
    const patch = await harness.app.evaluate(({ clipboard }) => clipboard.readText());
    expect(patch).toContain('--- ');
    expect(patch).toContain('+const timeout = 8000;');

    // ---------- cancelling the dialog produces nothing, quietly ----------
    await harness.app.evaluate(({ dialog }) => {
      dialog.showSaveDialog = () => Promise.resolve({ canceled: true, filePath: '' });
    });
    await harness.page.getByTestId('export-button').click();
    await harness.page.getByTestId('export-html').click();
    await expect(harness.page.getByTestId('export-menu')).toHaveCount(0);

    expect(harness.errors, `errors:\n${harness.errors.join('\n')}`).toEqual([]);
  } finally {
    await harness.close();
    await rm(output, { recursive: true, force: true });
  }
});
