/**
 * The testable half of the update check (v0.2.13): everything that turns bytes
 * from a server into a version, with no Electron and no socket in sight.
 *
 * It is separate from `update.ts` for the reason `engines/git/refs.ts` and
 * `cli/thresholds.ts` are separate from their callers — the parsing is where the
 * mistakes are, and a unit test is a cheaper way to find them than a launched app.
 *
 * Everything here treats the response as hostile. The feed is served over TLS
 * from a host we do not control, and its only job is to *name a version*: no URL,
 * no path, no filename and no markup from it reaches anything else. See
 * `update.ts` for why the release page is a constant rather than the feed's own
 * `html_url`.
 */

/** `0.3.0` or `v0.3.0`, and nothing else. */
const VERSION = /^v?(\d+)\.(\d+)\.(\d+)$/;

/**
 * A version as three numbers, or `null` for anything that is not exactly one.
 *
 * Deliberately stricter than semver: TwinScope has never published a
 * prerelease or a build-metadata tag, and a parser that accepts more than it
 * needs is a parser that accepts `javascript:alert(1)` on a bad day. The one
 * concession is the leading `v`, because that is how the tags are written.
 */
export function parseVersion(raw: string): [number, number, number] | null {
  const match = VERSION.exec(raw.trim());
  if (!match) return null;

  const parts = [match[1], match[2], match[3]].map((part) => Number(part));
  const [major, minor, patch] = parts as [number, number, number];
  // `\d+` cannot produce NaN, but it can produce something past 2^53.
  if (!parts.every((part) => Number.isSafeInteger(part))) return null;

  return [major, minor, patch];
}

/** True when `latest` is a strictly higher version than `current`. */
export function isNewer(latest: string, current: string): boolean {
  const a = parseVersion(latest);
  const b = parseVersion(current);
  if (a === null || b === null) return false;

  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return (a[index] as number) > (b[index] as number);
  }

  return false;
}

/**
 * The version a GitHub release document names, or `null`.
 *
 * `/releases/latest` already excludes drafts and prereleases, but the flags are
 * checked anyway: this is the one place where trusting the endpoint's contract
 * instead of its payload would announce an unfinished release to every user.
 */
export function latestFromFeed(body: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  if (record['draft'] === true || record['prerelease'] === true) return null;

  const tag = record['tag_name'];
  if (typeof tag !== 'string') return null;

  // Normalised on the way out, so nothing downstream has to think about the `v`.
  return parseVersion(tag) === null ? null : tag.trim().replace(/^v/, '');
}
