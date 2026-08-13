import { BrowserWindow, app, net, shell } from 'electron';
import { IPC, type UpdateState } from '../shared/channels';
import { readPreferences } from './settings';
import { isNewer, latestFromFeed } from './updateFeed';

/**
 * Check-and-notify updates (v0.2.13).
 *
 * **This is the only network call TwinScope makes**, and it exists because the
 * owner changed the scope of §7 quality bar 1 on 2026-08-13 to allow it. Every
 * decision in this file follows from it being an exception rather than a licence:
 *
 * 1. **Off by default, and off means off.** `checkUpdates` now defaults to
 *    `false` and is parsed with `=== true` (`settings.ts`), like the two Quick
 *    Compare preferences. Nothing here opens a socket unless it is on — including
 *    `check()` called straight off the bridge, which *refuses* rather than
 *    obliging, so a compromised renderer cannot make the app phone home either.
 *    That is the invariant `e2e/regression/update.spec.ts` exists to hold.
 * 2. **It checks; it never installs.** `electron-updater` verifies a code
 *    signature before applying an update, and the app is unsigned by decision —
 *    so a self-updater is impossible on macOS, the one platform actually tested.
 *    Notifying and opening the release page works on all of them and needs no
 *    signature. The two decisions are independent and must not be confused.
 * 3. **The release page is a constant here, not the feed's `html_url`.** The
 *    response is the least trusted input in the app after a `twinscope://` link,
 *    and it decides exactly one thing: which version string gets displayed.
 *    `update:open` therefore takes **no argument** — neither the renderer nor the
 *    server can name a URL for `shell.openExternal` to open.
 * 4. **It sends as little as a request can.** No query string, no cookies or
 *    credentials, and a `User-Agent` of `TwinScope` without the version: GitHub
 *    requires a UA, and which build asked is not its business. What cannot be
 *    hidden is that an IP address asked at all, which is why the Settings row
 *    says so in as many words (the "UI disclosure" bar 1 requires).
 */

/** Injected by `electron.vite.config.ts` from package.json — see `currentVersion`. */
declare const __TWINSCOPE_VERSION__: string;

/** Where the check reads from. Overridable only under test — see `feedUrl`. */
const FEED = 'https://api.github.com/repos/codeAesthetic/twinscope/releases/latest';

/** Hard-coded, and the only URL this app ever hands to the browser. */
export const RELEASE_PAGE = 'https://github.com/codeAesthetic/twinscope/releases/latest';

const TIMEOUT_MS = 8_000;

/** A release document is a few KB. Anything approaching this is not one. */
const MAX_BYTES = 256 * 1024;

/**
 * Startup checks wait, so a launch never blocks on a socket. Zero under test —
 * the harness has a local feed and no interest in the delay.
 */
const STARTUP_DELAY_MS = 4_000;

let state: UpdateState = { status: 'off', current: '0.0.0' };
let inFlight: Promise<UpdateState> | null = null;
let startupTimer: NodeJS.Timeout | null = null;

/**
 * This build's version.
 *
 * **Not `app.getVersion()`**: unpackaged there is no package.json beside
 * `out/main/index.js`, and Electron then answers with *its own* version — so the
 * check compared a release against `43.4.0` and the notice offered the user an
 * upgrade to their Electron. The build-time constant is the honest answer, with
 * `app.getVersion()` kept as a fallback for any path that misses the define.
 */
function currentVersion(): string {
  return typeof __TWINSCOPE_VERSION__ === 'string' ? __TWINSCOPE_VERSION__ : app.getVersion();
}

function feedUrl(): string {
  const override = process.env['TWINSCOPE_UPDATE_FEED'];
  // Only under test: an env var that could redirect a real user's update check
  // is a hole, however harmless the payload's use is.
  if (override !== undefined && process.env['NODE_ENV'] === 'test') return override;
  return FEED;
}

function publish(next: UpdateState): UpdateState {
  state = next;
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.webContents.isDestroyed()) continue;
    window.webContents.send(IPC.updateState, state);
  }
  return state;
}

export function updateState(): UpdateState {
  return { ...state, current: currentVersion() };
}

/** Opens the release page in the user's browser. Takes no argument, by design. */
export function openReleasePage(): Promise<void> {
  return shell.openExternal(RELEASE_PAGE);
}

interface FeedResponse {
  status: number;
  body: string;
}

/**
 * One GET, bounded three ways: a timeout, a byte cap, and a body that is only
 * ever read as JSON. Rejects rather than throwing asynchronously, so the caller
 * has a single place to turn a failure into a displayable message.
 */
function requestFeed(url: string): Promise<FeedResponse> {
  return new Promise<FeedResponse>((resolve, reject) => {
    const request = net.request({
      method: 'GET',
      url,
      // Overrides `useSessionCookies`: nothing about an update check should carry
      // the session's cookies, and this request has no notion of a logged-in user.
      credentials: 'omit',
      cache: 'no-cache',
    });

    request.setHeader('Accept', 'application/vnd.github+json');
    request.setHeader('User-Agent', 'TwinScope');

    let settled = false;
    const finish = (action: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      action();
    };

    const timer = setTimeout(() => {
      finish(() => {
        request.abort();
        reject(new Error('the update check timed out'));
      });
    }, TIMEOUT_MS);

    request.on('response', (response) => {
      const chunks: Buffer[] = [];
      let bytes = 0;

      response.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > MAX_BYTES) {
          finish(() => {
            request.abort();
            reject(new Error('the update feed returned too much data'));
          });
          return;
        }
        chunks.push(chunk);
      });

      response.on('end', () => {
        finish(() =>
          resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString('utf8') }),
        );
      });

      response.on('error', (error: Error) => finish(() => reject(error)));
    });

    request.on('error', (error) => finish(() => reject(error)));
    request.end();
  });
}

/**
 * Checks once, and returns the resulting state.
 *
 * Refuses — without a request — while the preference is off. A second call
 * during a check joins the first rather than opening another socket.
 */
export async function checkForUpdate(): Promise<UpdateState> {
  const current = currentVersion();

  if (!readPreferences().checkUpdates) {
    return publish({ status: 'off', current });
  }

  if (inFlight) return inFlight;

  publish({ status: 'checking', current, ...(state.latest ? { latest: state.latest } : {}) });

  inFlight = (async (): Promise<UpdateState> => {
    const checkedAt = new Date().toISOString();
    try {
      const { status, body } = await requestFeed(feedUrl());
      if (status < 200 || status >= 300) {
        return publish({
          status: 'error',
          current,
          message: `the update feed answered ${status}`,
          checkedAt,
        });
      }

      const latest = latestFromFeed(body);
      if (latest === null) {
        // A 200 that names no version is a broken feed, not "you are up to date":
        // reporting the latter would leave the user believing a check happened.
        return publish({
          status: 'error',
          current,
          message: 'the update feed did not name a version',
          checkedAt,
        });
      }

      return isNewer(latest, current)
        ? publish({ status: 'available', current, latest, checkedAt })
        : publish({ status: 'current', current, latest, checkedAt });
    } catch (error) {
      return publish({
        status: 'error',
        current,
        message: error instanceof Error ? error.message : 'the update check failed',
        checkedAt,
      });
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

/**
 * Arranges the one automatic check, when the preference asks for it.
 *
 * Called after the window exists so the result has somewhere to land, and
 * delayed so a cold start never waits on the network.
 */
export function scheduleStartupCheck(): void {
  if (!readPreferences().checkUpdates) {
    publish({ status: 'off', current: currentVersion() });
    return;
  }

  const delay = process.env['TWINSCOPE_UPDATE_FEED'] !== undefined ? 0 : STARTUP_DELAY_MS;
  startupTimer = setTimeout(() => {
    startupTimer = null;
    void checkForUpdate();
  }, delay);
  // A pending check must not hold the process open on quit.
  startupTimer.unref();
}

export function cancelStartupCheck(): void {
  if (startupTimer === null) return;
  clearTimeout(startupTimer);
  startupTimer = null;
}
