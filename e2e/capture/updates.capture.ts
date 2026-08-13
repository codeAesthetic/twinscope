import { createServer, type Server } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { expect, test, type Page } from '@playwright/test';
import { freshWorkDir } from './helpers/fixtures';
import { stage, statusBarTop, still } from './helpers/stage';

/**
 * MEDIA-1 still for the update notice (v0.2.13).
 *
 * This is the one asset that needs the app's **only** network call, so it is also the
 * one that must not touch the real one: the feed is a server on 127.0.0.1 that main
 * really talks to, the way `e2e/regression/update.spec.ts` does it. Nothing leaves the
 * machine, and the published picture cannot depend on what GitHub happens to be
 * serving. (`TWINSCOPE_UPDATE_FEED` is honoured only under `NODE_ENV=test`, which the
 * harness sets — an env var that could redirect a real user's check would be a hole.)
 *
 * Both versions in the shot are **derived from package.json**, never typed here:
 * `app.getVersion()` answers with *Electron's* version unpackaged, and a notice
 * offering to upgrade the user's Electron to 99.9.9 is exactly the bug that shipped
 * for the length of one screenshot. A capture that asked the app what version it was
 * would agree with that bug; reading package.json is what makes the assertion able to
 * catch it, which is why the Electron version is asserted *absent* below.
 */

const APP_VERSION = (
  JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf8')) as { version: string }
).version;

/**
 * The next **patch** of this build — the version that would really come next.
 *
 * Derived rather than invented, and specifically not the next minor: every feature
 * here ships as a patch release and the series number itself is never published
 * (D30), so a picture announcing `0.4.0` would name a release that cannot exist.
 * `99.9.9` is the other wrong answer — it reads as a mock and undermines the one
 * thing this asset claims. It also exercises the comparison honestly: `0.3.10` is
 * newer than `0.3.9` numerically and older lexically.
 */
function nextPatch(version: string): string {
  const parts = version.split('.').map((part) => Number(part));
  const major = parts[0] ?? 0;
  const minor = parts[1] ?? 0;
  const patch = parts[2] ?? 0;
  return `${major}.${minor}.${patch + 1}`;
}

const LATEST = nextPatch(APP_VERSION);

/** Padding around the toast. Kept out of the status bar — see the assertion below. */
const PAD = 12;

/** Waits for two composited frames — see the note at the screenshot. */
async function settle(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
  await page.waitForTimeout(250);
}

interface Feed {
  url: string;
  requests: number;
  close: () => Promise<void>;
}

/** A release document, and nothing else: `tag_name` is all the app reads. */
async function startFeed(): Promise<Feed> {
  const feed = { requests: 0 } as Feed;
  const server: Server = createServer((_request, response) => {
    feed.requests += 1;
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ tag_name: `v${LATEST}` }));
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  feed.url = `http://127.0.0.1:${port}/releases/latest`;
  feed.close = () =>
    new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    });

  return feed;
}

/**
 * A profile with the preference already on, as a user who opted in would have.
 *
 * The check is off by default and off means off — `checkForUpdate()` refuses without
 * making a request — so there is no way to photograph this state without saying yes
 * first. Written into the capture work directory, which is wiped between runs.
 */
function optedInProfile(): string {
  const dir = freshWorkDir('update-profile');
  writeFileSync(
    join(dir, 'settings.json'),
    JSON.stringify({
      version: 1,
      preferences: { theme: 'dark', engineDefaults: {}, checkUpdates: true },
    }),
    'utf8',
  );
  return dir;
}

test('stills: the notice naming a newer version than this build', async () => {
  const feed = await startFeed();
  const harness = await stage({
    userDataDir: optedInProfile(),
    env: { TWINSCOPE_UPDATE_FEED: feed.url },
  });

  try {
    // ---------- the startup check runs on its own, and the notice arrives ----------
    const toast = harness.page.getByTestId('update-toast');
    await expect(toast).toBeVisible({ timeout: 20_000 });
    await expect(toast).toContainText(`TwinScope ${LATEST} is available`);
    await expect(toast).toContainText(`you have ${APP_VERSION}`);
    await expect(harness.page.getByTestId('update-open')).toBeVisible();

    // The app's version, not Electron's — see the header note.
    const electron = await harness.app.evaluate(() => process.versions.electron);
    await expect(toast).not.toContainText(electron);

    // ---------- one request, to 127.0.0.1, and nowhere else ----------
    expect(feed.requests, 'the check should have happened exactly once').toBe(1);

    // The toast floats above the status bar, which prints "electron <version>" in an
    // unpackaged run — so the clip has to stop short of it or the asset would bake in
    // a number that goes stale on the next Electron bump.
    const box = await toast.boundingBox();
    expect(box, 'the toast should have a box to clip to').not.toBeNull();
    const bottom = (box?.y ?? 0) + (box?.height ?? 0) + PAD;
    expect(bottom, 'the clip must stay clear of the status bar').toBeLessThan(
      await statusBarTop(harness),
    );

    // The toast is pushed in by main and appears mid-idle over a painted window, and
    // it carries a large blurred shadow. Shot on the frame it arrives, Chromium
    // sometimes rasterises that shadow one level differently — invisible (every
    // channel within 1) but enough to change the file's bytes, which is a diff in the
    // website repo for nothing. Two frames of settling makes it repeatable.
    await settle(harness.page);
    await still(harness, 'update-notice', { clip: ['update-toast'], pad: PAD });

    expect(harness.errors, `errors:\n${harness.errors.join('\n')}`).toEqual([]);
  } finally {
    await harness.close();
    await feed.close();
  }
});
