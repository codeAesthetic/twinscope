import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, test } from '@playwright/test';
import { launchApp, type Harness } from '../helpers/launch';

/**
 * REGRESSION — v0.2.12: the `twinscope://` protocol.
 *
 * The parser is unit-tested; what this proves is the *behaviour* around it, which is
 * the part that matters for a URL any web page can open:
 *
 *  - accepting the confirmation compares the two files it named;
 *  - declining it loads nothing at all;
 *  - a link naming a path that does not exist, or a relative one, changes nothing.
 *
 * The confirmation itself is a native modal, which Playwright cannot drive, so main
 * exposes `__twinscopeOpenLink(url, accept)` under NODE_ENV=test — the same seam
 * pattern the engine-host kill switch uses, reachable only from the test process.
 */

async function openLink(harness: Harness, url: string, accept: boolean): Promise<boolean> {
  return harness.app.evaluate(
    async (_electron, [link, ok]) => {
      const open = (globalThis as Record<string, unknown>)['__twinscopeOpenLink'] as (
        raw: string,
        accepted: boolean,
      ) => Promise<boolean>;
      return open(link, ok as boolean);
    },
    [url, accept] as [string, boolean],
  );
}

test('deep link: a confirmed link compares the pair, a declined one does nothing', async () => {
  const harness = await launchApp();
  let dir: string | null = null;

  try {
    dir = await mkdtemp(join(tmpdir(), 'twinscope-link-'));
    const a = join(dir, 'before.json');
    const b = join(dir, 'after.json');
    await writeFile(a, '{"retries":1}\n');
    await writeFile(b, '{"retries":5}\n');

    const link = `twinscope://compare?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`;

    // ---------- declining does nothing ----------
    expect(await openLink(harness, link, false)).toBe(false);
    await expect(harness.page.getByTestId('drop-before').locator('.dd-filecard')).toHaveCount(0);

    // ---------- accepting compares the pair it named ----------
    expect(await openLink(harness, link, true)).toBe(true);
    await expect(harness.page.getByTestId('summary-strip')).toContainText('～1 modified', {
      timeout: 20_000,
    });
    await expect(harness.page.getByTestId('workspace-toolbar')).toContainText(
      'Structural JSON diff',
    );

    await harness.screenshot('deep-link-opened');

    // ---------- the report's own link is one this app accepts ----------
    // The loop the feature is for: export a report, take the URL out of it, open it.
    const reportPath = join(dir, 'report.html');
    await harness.app.evaluate(({ dialog }, path: string) => {
      dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath: path });
    }, reportPath);
    await harness.page.getByTestId('export-button').click();
    await harness.page.getByTestId('export-html').click();
    await expect(harness.page.getByTestId('export-toast')).toContainText('Report saved');

    const report = await readFile(reportPath, 'utf8');
    const href = /href="(twinscope:\/\/compare[^"]+)"/.exec(report)?.[1];
    expect(href, 'the report should carry an Open in TwinScope link').toBeDefined();
    // Un-escape the HTML entity the attribute carries, then feed it back in.
    expect(await openLink(harness, (href as string).replace(/&amp;/g, '&'), true)).toBe(true);
    await expect(harness.page.getByTestId('summary-strip')).toContainText('～1 modified', {
      timeout: 20_000,
    });

    // ---------- refusals ----------
    // A relative path is refused rather than resolved against the app's cwd.
    expect(await openLink(harness, 'twinscope://compare?a=before.json&b=after.json', true)).toBe(
      false,
    );
    // A file that does not exist fails at the read, not at the guard — and does not
    // leave a half-loaded comparison behind.
    expect(
      await openLink(
        harness,
        `twinscope://compare?a=${encodeURIComponent(join(dir, 'gone.json'))}&b=${encodeURIComponent(b)}`,
        true,
      ).catch(() => false),
    ).toBe(false);
    // Another scheme, another action.
    expect(await openLink(harness, 'twinscope://run?a=%2Ftmp%2Fa&b=%2Ftmp%2Fb', true)).toBe(false);

    expect(harness.errors, `errors:\n${harness.errors.join('\n')}`).toEqual([]);
  } finally {
    if (dir !== null) await rm(dir, { recursive: true, force: true });
    await harness.close();
  }
});
