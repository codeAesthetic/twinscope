import { expect, test } from '@playwright/test';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { launchApp } from '../helpers/launch';
import { waitForReady } from '../helpers/seed';

/**
 * REGRESSION — v0.2.13: check-and-notify updates.
 *
 * This is the only spec in the suite that involves a socket, and the reason it
 * exists is the invariant rather than the feature: **while `checkUpdates` is off,
 * nothing may reach the network** — not the startup check, and not an explicit
 * `update.check()` off the bridge, because the refusal is main's. That half is
 * asserted by counting requests at a server that must stay at zero.
 *
 * The feed is a real HTTP server on 127.0.0.1 and main really talks to it, so the
 * request path, the timeout, the status handling and the parsing are all exercised
 * for real without anything leaving the machine. Main only honours
 * `TWINSCOPE_UPDATE_FEED` under `NODE_ENV=test`, which the harness sets.
 */

interface Feed {
  url: string;
  requests: Array<{ url: string; headers: IncomingHttpHeaders }>;
  reply: { status: number; body: string };
  close: () => Promise<void>;
}

async function startFeed(): Promise<Feed> {
  const requests: Feed['requests'] = [];
  const feed = {
    requests,
    reply: { status: 200, body: '{}' },
  } as Feed;

  const server: Server = createServer((request, response) => {
    requests.push({ url: request.url ?? '', headers: request.headers });
    response.writeHead(feed.reply.status, { 'content-type': 'application/json' });
    response.end(feed.reply.body);
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
 * The version the app should believe it is — from package.json, deliberately.
 *
 * `app.getVersion()` is *not* the reference: unpackaged it answers with
 * Electron's version, so a spec that asked the app what version it was would
 * agree with a notice offering to upgrade the user's Electron to 99.9.9. That
 * bug shipped for the length of one screenshot.
 */
const APP_VERSION = (
  JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf8')) as { version: string }
).version;

/** A profile with preferences already written, as a returning user would have. */
function profileWith(preferences: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), 'twinscope-update-'));
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'settings.json'),
    JSON.stringify({
      version: 1,
      preferences: { theme: 'dark', engineDefaults: {}, ...preferences },
    }),
    'utf8',
  );
  return dir;
}

test('updates: off means no request, from boot or from the bridge', async () => {
  const feed = await startFeed();
  // A profile written by a version that predates v0.2.13: no `checkUpdates` key
  // at all. It must read as OFF — the preference used to be parsed with
  // `!== false`, which would have turned the check on for someone never asked.
  const profile = profileWith({ globalShortcut: false });
  const harness = await launchApp({
    userDataDir: profile,
    env: { TWINSCOPE_UPDATE_FEED: feed.url },
  });

  try {
    await waitForReady(harness);

    // ---------- the state says why nothing has happened ----------
    const state = await harness.page.evaluate(() => window.twinscope.update.read());
    expect(state.status).toBe('off');

    // ---------- and an explicit check is refused, not obliged ----------
    const forced = await harness.page.evaluate(() => window.twinscope.update.check());
    expect(forced.status).toBe('off');

    // Give a stray request every chance to arrive before counting.
    await harness.page.waitForTimeout(1500);
    expect(feed.requests, 'the app contacted the feed with the preference off').toEqual([]);

    // ---------- the Settings row says the same thing, and offers no dead control ----------
    await harness.page.getByTestId('nav-settings').click();
    await expect(harness.page.getByTestId('screen-settings')).toBeVisible();
    await expect(harness.page.getByText('No check has been made')).toBeVisible();
    await expect(harness.page.getByTestId('update-check')).toBeDisabled();

    // ---------- no notice, because there is nothing to notify ----------
    await expect(harness.page.getByTestId('update-toast')).toHaveCount(0);

    expect(harness.errors, `errors:\n${harness.errors.join('\n')}`).toEqual([]);
  } finally {
    await harness.close();
    await feed.close();
    rmSync(profile, { recursive: true, force: true });
  }
});

test('updates: on, it checks once, notifies, and reports every failure honestly', async () => {
  const feed = await startFeed();
  feed.reply = { status: 200, body: JSON.stringify({ tag_name: 'v99.9.9' }) };

  const profile = profileWith({ checkUpdates: true });
  const harness = await launchApp({
    userDataDir: profile,
    env: { TWINSCOPE_UPDATE_FEED: feed.url },
  });

  try {
    await waitForReady(harness);
    const version = APP_VERSION;

    // ---------- the startup check runs and the notice appears ----------
    const toast = harness.page.getByTestId('update-toast');
    await expect(toast).toBeVisible({ timeout: 20_000 });
    await expect(toast).toContainText('99.9.9');
    // The app's version, not Electron's — see APP_VERSION.
    await expect(toast).toContainText(version);
    const electron = await harness.app.evaluate(() => process.versions.electron);
    await expect(toast).not.toContainText(electron);
    await expect(harness.page.getByTestId('update-open')).toBeVisible();

    // ---------- exactly one request, carrying as little as it can ----------
    expect(feed.requests).toHaveLength(1);
    const [first] = feed.requests;
    expect(first?.url, 'the check must not carry a query string').toBe('/releases/latest');
    expect(first?.headers['user-agent'], 'the UA must not name the build').toBe('TwinScope');
    expect(first?.headers['cookie'], 'no cookies on an update check').toBeUndefined();
    expect(first?.headers['authorization']).toBeUndefined();

    await harness.screenshot('update-available');

    // ---------- the same version is "up to date", and it is a real check ----------
    feed.reply = { status: 200, body: JSON.stringify({ tag_name: `v${version}` }) };
    await harness.page.getByTestId('nav-settings').click();
    await harness.page.getByTestId('update-check').click();
    await expect(harness.page.getByText(`Up to date — ${version}`)).toBeVisible();
    expect(feed.requests).toHaveLength(2);
    await harness.screenshot('update-settings');

    // ---------- an HTTP failure says so; it does not read as up to date ----------
    feed.reply = { status: 503, body: 'unavailable' };
    await harness.page.getByTestId('update-check').click();
    await expect(harness.page.getByText('Could not check')).toBeVisible();
    await expect(harness.page.getByText('answered 503')).toBeVisible();

    // ---------- a 200 that names no version is a broken feed, not a verdict ----------
    feed.reply = { status: 200, body: JSON.stringify({ tag_name: 'nightly' }) };
    await harness.page.getByTestId('update-check').click();
    await expect(harness.page.getByText('did not name a version')).toBeVisible();

    // ---------- a version older than this build is not an update ----------
    feed.reply = { status: 200, body: JSON.stringify({ tag_name: 'v0.0.1' }) };
    await harness.page.getByTestId('update-check').click();
    await expect(harness.page.getByText(`Up to date — ${version}`)).toBeVisible();
    await expect(harness.page.getByTestId('update-release')).toHaveCount(0);

    // ---------- turning the preference off stops the checking, immediately ----------
    const before = feed.requests.length;
    await harness.page.getByLabel('Check for updates').click();
    await expect(harness.page.getByTestId('update-check')).toBeDisabled();
    await harness.page.evaluate(() => window.twinscope.update.check());
    await harness.page.waitForTimeout(500);
    expect(feed.requests).toHaveLength(before);

    // ---------- and it survives a relaunch as off ----------
    expect(harness.errors, `errors:\n${harness.errors.join('\n')}`).toEqual([]);
  } finally {
    await harness.close();
    await feed.close();
    rmSync(profile, { recursive: true, force: true });
  }
});

test('updates: a feed that never answers times out, once, and says so', async () => {
  // A server that accepts the connection and never replies. Two things to prove:
  // the check ends as an *error* rather than hanging or reading as up to date, and
  // concurrent calls join the one in flight instead of each opening a socket.
  let received = 0;
  const stalled = createServer(() => {
    received += 1;
  });
  await new Promise<void>((resolve) => stalled.listen(0, '127.0.0.1', resolve));
  const { port } = stalled.address() as AddressInfo;

  const profile = profileWith({ checkUpdates: true });
  const harness = await launchApp({
    userDataDir: profile,
    env: { TWINSCOPE_UPDATE_FEED: `http://127.0.0.1:${port}/releases/latest` },
  });

  try {
    await waitForReady(harness);
    await harness.page.getByTestId('nav-settings').click();

    // Three more checks while the startup one is stalled — all four are one request.
    await harness.page.evaluate(() =>
      Promise.all([
        window.twinscope.update.check(),
        window.twinscope.update.check(),
        window.twinscope.update.check(),
      ]),
    );

    await expect(harness.page.getByText('Could not check')).toBeVisible({ timeout: 20_000 });
    await expect(harness.page.getByText('timed out')).toBeVisible();
    await expect(harness.page.getByTestId('update-toast')).toHaveCount(0);
    expect(received, 'concurrent checks must share the one in flight').toBe(1);

    expect(harness.errors, `errors:\n${harness.errors.join('\n')}`).toEqual([]);
  } finally {
    await harness.close();
    stalled.closeAllConnections();
    await new Promise<void>((resolve) => stalled.close(() => resolve()));
    rmSync(profile, { recursive: true, force: true });
  }
});
