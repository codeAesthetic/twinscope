import { BrowserWindow, app, dialog } from 'electron';
import { basename } from 'node:path';
import { handoffToMain } from './quick';
import { readInput } from './input';
import { parseCompareLink, PROTOCOL, type CompareLink } from '../shared/deepLink';
import { PathSchema } from '../shared/schemas';

/**
 * The `twinscope://` protocol handler (v0.2.12).
 *
 * A deep link is the least trusted input the app has: any web page, mail client or
 * document can open one, with no user gesture that says which app it lands in. So
 * this path is deliberately three checks deep:
 *
 *  1. `shared/deepLink.ts` parses it — pure, unit-tested, absolute paths only;
 *  2. every path then goes through `PathSchema`, exactly like a renderer's would;
 *  3. **the user is asked**, with both paths named, before anything is read.
 *
 * The third is the one that matters. Without it,
 * `twinscope://compare?a=/etc/passwd&b=/etc/hosts` on a web page would make
 * TwinScope display two of the user's files to whoever asked.
 *
 * After the confirmation the pair goes through v0.2.14's handoff, which *runs* the
 * comparison — the same thing the quick panel's Compare does. Loading it and waiting
 * for another click was the first design and it protects nothing: agreeing to open
 * two named files is agreeing to see them compared, and "Open in TwinScope" from a
 * report that then shows an unstarted comparison reads as a failure.
 */

/** Registers the scheme with the OS. Safe to call more than once. */
export function registerProtocol(): void {
  // In development the executable is Electron itself, so the launcher has to be
  // told which script to run — without this a registered scheme opens a bare
  // Electron instead of TwinScope.
  if (process.defaultApp && process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [process.argv[1] as string]);
    return;
  }
  app.setAsDefaultProtocolClient(PROTOCOL);
}

/** The first `twinscope://` URL in an argv, which is how Windows and Linux deliver one. */
export function linkFromArgv(argv: readonly string[]): string | null {
  return argv.find((argument) => argument.startsWith(`${PROTOCOL}://`)) ?? null;
}

/**
 * Handles one URL: parse, validate, ask, load, hand off.
 *
 * Returns false for anything that did not end in a loaded pair — a malformed link,
 * a refused path, a declined dialog — and deliberately does not distinguish them to
 * the caller. `confirm` is injectable so the spec can drive the accept and the
 * decline without a native modal.
 */
export async function handleCompareLink(
  raw: string,
  options: { confirm?: (link: CompareLink) => Promise<boolean> } = {},
): Promise<boolean> {
  const link = parseCompareLink(raw);
  if (link === null) return false;

  // The same normalisation every renderer path gets: absolute, NUL-free, canonical.
  const paths = PathSchema.array().safeParse([link.a, link.b]);
  if (!paths.success) return false;
  const [a, b] = paths.data as [string, string];

  const ask = options.confirm ?? confirmWithDialog;
  if (!(await ask({ ...link, a, b }))) return false;

  const [payloadA, payloadB] = await Promise.all([readInput('A', a), readInput('B', b)]);
  const main = BrowserWindow.getAllWindows().find((window) => !window.isDestroyed()) ?? null;
  return handoffToMain(main, { a: payloadA, b: payloadB });
}

/**
 * The modal. Both full paths are shown, not just the basenames: the whole question
 * is *which* files a stranger's link wants opened, and "compare a.json and b.json?"
 * answers nothing.
 */
async function confirmWithDialog(link: CompareLink): Promise<boolean> {
  const window = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed());
  const detail = `${link.a}\n${link.b}`;
  const options = {
    type: 'question' as const,
    buttons: ['Open in TwinScope', 'Cancel'],
    defaultId: 0,
    cancelId: 1,
    title: 'Open a comparison?',
    message: `A link is asking TwinScope to open ${basename(link.a)} and ${basename(link.b)}.`,
    detail: `${detail}\n\nNothing is read until you agree. TwinScope will then compare them; nothing leaves your machine.`,
  };

  const { response } =
    window === undefined
      ? await dialog.showMessageBox(options)
      : await dialog.showMessageBox(window, options);
  return response === 0;
}

/**
 * Wires the two ways an OS delivers a URL: `open-url` on macOS, and an argument on
 * Windows and Linux — where a *second* launch is what carries the link, so it
 * arrives through `second-instance` rather than at startup.
 */
export function registerProtocolHandlers(): void {
  app.on('open-url', (event, url) => {
    event.preventDefault();
    void handleCompareLink(url);
  });

  app.on('second-instance', (_event, argv) => {
    const url = linkFromArgv(argv);
    if (url !== null) void handleCompareLink(url);
  });

  // A cold start *with* a link on the command line, which is the Windows and Linux
  // first-launch case.
  const startup = linkFromArgv(process.argv);
  if (startup !== null) void handleCompareLink(startup);
}
