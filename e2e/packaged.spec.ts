import { _electron as electron } from '@playwright/test';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, test } from '@playwright/test';

/**
 * The packaged app (MVP-12).
 *
 * `npm run verify` proves the built *source* works. This proves the thing a user
 * actually installs works — asar packing, the icon, the resources path, and the
 * database landing in `userData` rather than beside the binary.
 *
 * Opt-in, so `npm run verify` keeps testing the *source* rather than whatever
 * package happens to be lying in `release/` from an earlier build:
 *   npm run verify:packaged
 */
const APP = resolve(
  __dirname,
  '..',
  'release',
  process.arch === 'arm64' ? 'mac-arm64' : 'mac',
  'TwinScope.app',
  'Contents',
  'MacOS',
  'TwinScope',
);

test.describe('packaged app', () => {
  test.skip(
    process.env['TWINSCOPE_PACKAGED'] !== '1' || !existsSync(APP),
    'set TWINSCOPE_PACKAGED=1 and run `npm run package:mac` first',
  );

  test('installs, compares, persists and reports its memory', async () => {
    const profile = await mkdtemp(join(tmpdir(), 'twinscope-packaged-'));
    const files = await mkdtemp(join(tmpdir(), 'twinscope-packaged-files-'));

    const app = await electron.launch({
      executablePath: APP,
      args: [`--user-data-dir=${profile}`],
    });

    try {
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');

      // ---------- it boots, and the bridge is there ----------
      await expect(page.getByTestId('screen-compare')).toBeVisible({ timeout: 30_000 });
      const versions = await page.evaluate(() => window.twinscope.ping());
      expect(versions.pong).toBe(true);

      // ---------- a real comparison, through the packaged engine host ----------
      const before = join(files, 'a.json');
      const after = join(files, 'b.json');
      await writeFile(before, JSON.stringify({ tier: 'free', seats: 1 }, null, 2));
      await writeFile(after, JSON.stringify({ tier: 'pro', seats: 5 }, null, 2));

      await app.evaluate(
        ({ dialog }, paths: string[]) => {
          let call = 0;
          dialog.showOpenDialog = () =>
            Promise.resolve({ canceled: false, filePaths: [paths[call++] ?? paths[0]!] });
        },
        [before, after],
      );

      await page.getByTestId('pick-file-before').click();
      await page.getByTestId('pick-file-after').click();
      await page.getByTestId('compare-button').click();

      await expect(page.getByTestId('json-tree')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('summary-strip')).toContainText('～2 modified');

      // ---------- syntax highlighting: the path most likely to break only here
      // Shiki's grammars are dynamic imports, and in a packaged build those
      // chunks live inside the asar and load over file://. Nothing in the
      // unpackaged suite proves that resolves. ----------
      await page.getByTestId('back-button').click();

      const codeBefore = join(files, 'client.ts');
      const codeAfter = join(files, 'client.next.ts');
      await writeFile(codeBefore, 'const timeout = 5000;\nexport function request() {}\n');
      await writeFile(codeAfter, 'const timeout = 8000;\nexport function request(x) {}\n');

      await app.evaluate(
        ({ dialog }, paths: string[]) => {
          let call = 0;
          dialog.showOpenDialog = () =>
            Promise.resolve({ canceled: false, filePaths: [paths[call++] ?? paths[0]!] });
        },
        [codeBefore, codeAfter],
      );

      await page.getByTestId('pick-file-before').click();
      await page.getByTestId('pick-file-after').click();
      await page.getByTestId('compare-button').click();

      const diff = page.getByTestId('text-diff');
      await expect(diff).toBeVisible({ timeout: 30_000 });
      await expect(diff.locator('.dd-dtext span[style*="color"]').first()).toBeVisible({
        timeout: 30_000,
      });
      const distinctColours = await diff.evaluate((root) => {
        const spans = [...root.querySelectorAll('.dd-dtext span[style*="color"]')];
        return new Set(spans.map((span) => (span as HTMLElement).style.color)).size;
      });
      expect(distinctColours).toBeGreaterThan(1);

      // ---------- and search over the same rows ----------
      const search = page.getByTestId('workspace-search');
      await search.fill('timeout');
      await expect(page.getByTestId('search-count')).toContainText('/ 2');
      await search.fill('');

      // ---------- history landed in userData, not next to the binary ----------
      await page.getByTestId('back-button').click();
      await expect(page.getByTestId('recent-list')).toContainText('a.json ↔ b.json');
      expect(existsSync(join(profile, 'twinscope.db'))).toBe(true);

      // ---------- what it actually costs, per process ----------
      const metrics = await app.evaluate(({ app: electronApp }) =>
        electronApp.getAppMetrics().map((metric) => ({
          type: metric.type,
          mb: Math.round((metric.memory?.workingSetSize ?? 0) / 1024),
        })),
      );
      const total = metrics.reduce((sum, metric) => sum + metric.mb, 0);
      console.log(
        `[packaged] memory ${total} MB total — ` +
          metrics.map((metric) => `${metric.type} ${metric.mb}`).join(', '),
      );

      // A ceiling, not the §3.8 budget: this asserts nothing has doubled, and
      // the real number is logged above for the plan's table.
      expect(total).toBeLessThan(1200);
    } finally {
      await app.close();
      await rm(profile, { recursive: true, force: true });
      await rm(files, { recursive: true, force: true });
    }
  });
});
