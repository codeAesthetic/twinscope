import { stat } from 'node:fs/promises';
import { open } from 'node:fs/promises';
import { basename } from 'node:path';
import { detectKind, languageOf, looksBinary } from '../engines/detect';
import type { InputPayload } from '../shared/channels';

/**
 * Turns a path into an `InputPayload`: stat it, work out what it is, and inline
 * the text when it is small enough to be worth carrying.
 *
 * Anything larger than the cap travels as a path only and is read inside the
 * engine host instead, so IPC never moves multi-megabyte strings (MD §31).
 */

/** Above this, the text is left on disk for the engine host to stream. */
const INLINE_LIMIT_BYTES = 10 * 1024 * 1024;

/** The largest image the renderer will be handed in one piece. */
const MAX_BYTES = 64 * 1024 * 1024;

/** Enough to sniff binary content and JSON structure without reading the file. */
const SNIFF_BYTES = 8192;

async function sniff(path: string, size: number): Promise<string> {
  const handle = await open(path, 'r');
  try {
    const length = Math.min(SNIFF_BYTES, size);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, 0);
    return buffer.toString('utf8');
  } finally {
    await handle.close();
  }
}

/**
 * Raw bytes for one path. Used only by the image comparison, which runs in the
 * renderer because that is where the decoder lives (D8).
 *
 * The size cap keeps a hostile or mistaken request from pushing hundreds of
 * megabytes through IPC; the image engine downscales anything large anyway.
 */
export async function readBytes(path: string): Promise<Uint8Array> {
  const info = await stat(path);
  if (info.size > MAX_BYTES) {
    throw new Error(
      `${basename(path)} is ${(info.size / 1024 / 1024).toFixed(0)} MB — too large to open in the viewer.`,
    );
  }
  const { readFile } = await import('node:fs/promises');
  return new Uint8Array(await readFile(path));
}

export async function readInput(side: 'A' | 'B', path: string): Promise<InputPayload> {
  const info = await stat(path);
  const name = basename(path) || path;

  if (info.isDirectory()) {
    return { side, kind: 'folder', name: `${name}/`, path, size: 0 };
  }

  const head = info.size > 0 ? await sniff(path, info.size) : '';
  const detected = detectKind({ name, text: head, kind: 'unknown' });
  // Every image is "binary" by the NUL sniff, but a PNG is a format we can read,
  // not an opaque blob. Detection by extension wins for the kinds we support.
  const kind = detected === 'image' ? detected : looksBinary(head) ? 'binary' : detected;
  const lang = languageOf(name);

  const inlineable =
    info.size <= INLINE_LIMIT_BYTES && kind !== 'image' && kind !== 'binary' && kind !== 'folder';

  if (!inlineable) {
    return {
      side,
      kind,
      name,
      path,
      size: info.size,
      ...(lang !== undefined ? { lang } : {}),
      ...(info.size > INLINE_LIMIT_BYTES ? { large: true } : {}),
    };
  }

  // Small text: read it once here so the renderer can preview it immediately.
  const { readFile } = await import('node:fs/promises');
  const text = await readFile(path, 'utf8');

  return {
    side,
    kind: detectKind({ name, text, kind: 'unknown' }),
    name,
    path,
    size: info.size,
    text,
    ...(lang !== undefined ? { lang } : {}),
  };
}
