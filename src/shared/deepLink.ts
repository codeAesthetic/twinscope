/**
 * The `twinscope://` URL scheme (v0.2.12).
 *
 * This module is the feature's security boundary, so it is pure and unit-tested:
 * *anything* can open a URL — a web page, a mail client, another app — which makes
 * a deep link the least trusted input the app has. It parses and it refuses; it
 * never touches the filesystem, and the caller (`main/protocol.ts`) still asks the
 * user before reading anything.
 *
 * Shape: `twinscope://compare?a=<path>&b=<path>&engine=<id>`
 *
 * Both paths must be absolute. A relative path is refused rather than resolved
 * against whatever the app's working directory happens to be — "compare
 * ./secrets" would otherwise mean something different depending on how TwinScope
 * was launched.
 */

export const PROTOCOL = 'twinscope';

export interface CompareLink {
  a: string;
  b: string;
  /** A specific engine, when the link names one. */
  engine?: string;
}

/** Absolute POSIX (`/x`), UNC (`\\host\share`) or Windows (`C:\x`) — nothing else. */
function isAbsolute(path: string): boolean {
  return path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path) || path.startsWith('\\\\');
}

const ENGINE = /^[a-z][a-z0-9-]{0,31}$/;

/** The most a link may carry, so a URL cannot be used to push volume at the app. */
const MAX_PATH = 4096;

/**
 * Parses a compare link, or returns null.
 *
 * Null covers every rejection deliberately: a caller has nothing useful to do with
 * *why* a link from an unknown source was malformed, and a message quoting it back
 * would put attacker-chosen text in a dialog.
 */
export function parseCompareLink(raw: string): CompareLink | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  if (url.protocol !== `${PROTOCOL}:`) return null;
  // `twinscope://compare?…` parses with host 'compare' and an empty path, while
  // `twinscope:///compare?…` parses with an empty host — accept both, since the
  // second is what some launchers produce.
  const action = url.host !== '' ? url.host : url.pathname.replace(/^\/+/, '');
  if (action !== 'compare') return null;

  const a = url.searchParams.get('a');
  const b = url.searchParams.get('b');
  if (a === null || b === null) return null;
  if (a === '' || b === '' || a.length > MAX_PATH || b.length > MAX_PATH) return null;
  if (!isAbsolute(a) || !isAbsolute(b)) return null;
  // A NUL truncates inside libuv, so a path could be validated as one string and
  // opened as another. `PathSchema` rejects it too; this is the earlier of the two.
  if (a.includes('\0') || b.includes('\0')) return null;

  const engine = url.searchParams.get('engine');
  if (engine !== null && !ENGINE.test(engine)) return null;

  return { a, b, ...(engine !== null ? { engine } : {}) };
}

/**
 * Builds a compare link.
 *
 * Used by the HTML report's "Open in TwinScope" and mirrored by the VS Code
 * extension — which cannot import this file (it is a separate runtime with no build
 * step), so `integrations/vscode/extension.js` carries the same four lines and a
 * test here asserts the parser accepts exactly that shape.
 */
export function buildCompareLink(link: CompareLink): string {
  const parameters = new URLSearchParams({ a: link.a, b: link.b });
  if (link.engine !== undefined) parameters.set('engine', link.engine);
  return `${PROTOCOL}://compare?${parameters.toString()}`;
}
