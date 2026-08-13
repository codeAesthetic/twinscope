import { stat } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { decodeText } from '../engines/encoding';
import { detectKind, languageOf } from '../engines/detect';
import { assertSafeRef } from '../engines/git';
import type { InputRef } from '../engines/types';

/**
 * Turning a command-line operand into an `InputRef` (v0.2.2).
 *
 * The desktop app does this in `main/input.ts` and cannot be reused: it returns an
 * `InputPayload` shaped for IPC, withholds text over 10 MB because the payload has
 * to cross a process boundary, and validates paths as untrusted renderer input.
 * None of those three constraints exist here — the caller *is* the shell, and the
 * engine runs in this process — so the sizing rule inverts: read the text, because
 * there is nowhere for it to travel.
 */

/** Past this a text file is read by the engine through `HostFs` instead. */
const INLINE_LIMIT = 64 * 1024 * 1024;

export class CliInputError extends Error {}

export interface ResolveOptions {
  side: 'A' | 'B';
  operand: string;
  /** Set when the operands are git refs rather than paths. */
  repo?: string | undefined;
  /** Provided when the operand is `-`. */
  stdin?: string | undefined;
}

export async function resolveInput(options: ResolveOptions): Promise<InputRef> {
  const { side, operand, repo } = options;

  if (repo !== undefined) {
    assertSafeRef(operand);
    return {
      side,
      kind: 'git',
      name: `${basename(resolve(repo))} @ ${operand}`,
      path: resolve(repo),
      size: 0,
      ref: operand,
    };
  }

  if (operand === '-') {
    const text = options.stdin ?? '';
    // Named `stdin` rather than `-` so detection has something to work with and
    // the report header reads as English.
    const ref: InputRef = { side, kind: 'text', name: 'stdin', size: text.length, text };
    return { ...ref, kind: detectKind(ref) };
  }

  const path = resolve(operand);
  let info;
  try {
    info = await stat(path);
  } catch {
    throw new CliInputError(`${operand} does not exist.`);
  }

  if (info.isDirectory()) {
    return { side, kind: 'folder', name: basename(path) || path, path, size: 0 };
  }

  const name = basename(path);
  const language = languageOf(name);
  const base: InputRef = {
    side,
    kind: 'unknown',
    name,
    path,
    size: info.size,
    ...(language !== undefined ? { lang: language } : {}),
  };

  // An image is never read as text, and a huge file is left for the engine to
  // stream through HostFs rather than pulled into this process whole.
  const byExtension = detectKind({ name, kind: 'unknown' });
  if (byExtension === 'image' || info.size > INLINE_LIMIT) {
    return { ...base, kind: byExtension === 'unknown' ? 'text' : byExtension };
  }

  const { readFile } = await import('node:fs/promises');
  const decoded = decodeText(new Uint8Array(await readFile(path)));
  const withText: InputRef = { ...base, text: decoded.text };
  return { ...withText, kind: detectKind(withText) };
}

/** Reads all of stdin, or `undefined` when nothing is piped in. */
export async function readStdin(): Promise<string | undefined> {
  if (process.stdin.isTTY === true) return undefined;

  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  if (chunks.length === 0) return '';
  return decodeText(new Uint8Array(Buffer.concat(chunks))).text;
}
