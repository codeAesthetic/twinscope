import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, test } from '@playwright/test';
import { launchApp, type Harness } from '../helpers/launch';

/**
 * REGRESSION — v0.3.2: page comparison, the half that needs no network.
 *
 * Two claims worth a spec: two `.html` files are detected as *pages* rather than
 * line-diffed, and the four sections are four separate answers with their own counts.
 * The third is the honest one — the result says on screen that nothing was fetched,
 * rendered or screenshotted, because "no visual differences" is not something this
 * comparison looked for.
 */

const BEFORE = `<!doctype html>
<html lang="en">
<head>
  <title>Acme — Home</title>
  <link rel="stylesheet" href="/static/site.a1b2c3d4.css">
  <style>
    .hero { color: #111; padding: 24px }
    .footer { display: block }
  </style>
</head>
<body>
  <header id="masthead"><h1>Acme</h1></header>
  <main>
    <section class="hero"><h2>Everything you need</h2><p>Since 1998.</p></section>
    <img src="/img/logo.png">
    <form><label for="email">Email</label><input id="email"></form>
  </main>
  <script src="/static/app.a1b2c3d4.js"></script>
</body>
</html>
`;

const AFTER = `<!doctype html>
<html lang="en">
<head>
  <title>Acme — Home</title>
  <link rel="stylesheet" href="/static/site.99887766.css">
  <style>
    .hero { color: #333; padding: 24px }
    .footer { display: block }
    .badge { color: gold }
  </style>
</head>
<body>
  <header id="masthead"><h3>Acme</h3></header>
  <main>
    <section class="hero"><h2>Everything you need</h2><p>Since 1998. Now with badges.</p></section>
    <img src="/img/logo.png" alt="Acme">
    <form><label for="email">Email</label><input id="email"><input id="referrer"></form>
    <aside class="badge">New</aside>
  </main>
  <script src="/static/app.99887766.js"></script>
  <script src="/static/analytics.js"></script>
</body>
</html>
`;

async function stage(harness: Harness, files: Array<[string, string]>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'twinscope-web-'));
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

test('page diff: four sections, a cache-busted asset as one change, and an a11y verdict', async () => {
  const harness = await launchApp();
  let root: string | null = null;

  try {
    root = await stage(harness, [
      ['index.before.html', BEFORE],
      ['index.after.html', AFTER],
    ]);

    await harness.page.getByTestId('pick-file-before').click();
    await harness.page.getByTestId('pick-file-after').click();
    await expect(harness.page.getByTestId('detected-bar')).toContainText('Page diff');

    await harness.page.getByTestId('compare-button').click();
    const view = harness.page.getByTestId('web-view');
    await expect(view).toBeVisible({ timeout: 20_000 });

    // ---------- the sections carry their own counts ----------
    const strip = harness.page.getByTestId('summary-strip');
    await expect(strip).toContainText('structure');
    await expect(strip).toContainText('style');
    await expect(strip).toContainText('assets');
    await expect(strip).toContainText('a11y');

    // ---------- style: the declaration, not the rule ----------
    await harness.page.getByRole('tab', { name: /^Style/ }).click();
    await expect(view).toContainText('.hero');
    await expect(view).toContainText('color: #111 → #333');
    // A rule that only arrived says so rather than listing declarations.
    await expect(view.locator('[data-webkey=".badge"]')).toHaveAttribute('data-state', 'added');
    // …and the untouched rule is absent entirely.
    await expect(view.locator('[data-webkey=".footer"]')).toHaveCount(0);

    await harness.screenshot('web-style');

    // ---------- assets: two cache-busted files, one genuinely new ----------
    await harness.page.getByRole('tab', { name: /^Assets/ }).click();
    const changedAssets = view.locator('tr[data-state="changed"]');
    await expect(changedAssets).toHaveCount(2);
    await expect(view).toContainText('same asset, different URL');
    await expect(view).toContainText('analytics.js');

    // ---------- accessibility: the outline broke, and the alt arrived ----------
    await harness.page.getByRole('tab', { name: /^Accessibility/ }).click();
    const outline = view.locator('[data-webkey="heading outline"]');
    await expect(outline).toHaveAttribute('data-concern', 'true');
    // `<h1>Acme</h1><h2>Everything you need</h2>` became `<h3>…</h3><h2>…</h2>`: the
    // page now opens at level 3 and has no h1 at all.
    await expect(outline).toContainText('h1 h2');
    await expect(outline).toContainText('h3 h2');
    // The new input has no label, which is a problem this section exists to report.
    await expect(view.locator('[data-webkey="unlabelled controls"]')).toContainText(
      'the number of form controls with no label changed',
    );

    await harness.screenshot('web-a11y');

    // ---------- what it did not do is on screen ----------
    const scope = harness.page.getByTestId('web-scope');
    await expect(scope).toContainText('nothing fetched');
    await expect(scope).toContainText('no screenshot');

    // ---------- structure, and the option that makes a rebuild readable ----------
    await harness.page.getByRole('tab', { name: /^Structure/ }).click();
    await expect(view).toContainText('became <h3>');

    expect(harness.errors, `errors:\n${harness.errors.join('\n')}`).toEqual([]);
  } finally {
    if (root !== null) await rm(root, { recursive: true, force: true });
    await harness.close();
  }
});
