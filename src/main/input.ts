import { open, readFile, stat } from 'node:fs/promises';
import { basename } from 'node:path';
import { detectKind, languageOf } from '../engines/detect';
import { decodeText, describeEncoding, looksBinaryText } from '../engines/encoding';
import type { InputKind, InputPayload } from '../shared/channels';

/**
 * Turns a path into an `InputPayload`: stat it, work out what it is, and inline
 * the text when it is small enough to be worth carrying.
 *
 * Anything larger than the cap travels as a path only and is read inside the
 * engine host instead, so IPC never moves multi-megabyte strings (MD §31).
 */

/** Above this, the text is left on disk for the engine host to stream. */
const INLINE_LIMIT_BYTES = 10 * 1024 * 1024;

/** Enough to sniff binary content and JSON structure without reading the file. */
const SNIFF_BYTES = 8192;

/**
 * Kinds that are *legitimately* full of binary bytes and that the app can still
 * read. The NUL sniff must never override one of these into `binary`.
 *
 * `pdf` cost a released feature. Every image contains NULs, which is why `image`
 * was exempted from the start — but so does **every real PDF**: the streams are
 * Flate-compressed and the fonts are embedded, and both of the payslips this was
 * found on carry a NUL at byte 112. So a `.pdf` pair was detected as `pdf`, then
 * immediately demoted to `binary`, and the whole PDF engine was unreachable for
 * any document a real generator produced. It went unnoticed because every fixture
 * in the suite is hand-written, uncompressed and pure ASCII — see the compressed
 * fixture in `e2e/helpers/pdf.ts`, which exists to make this failable.
 */
const READABLE_BINARY: ReadonlySet<InputKind> = new Set(['image', 'pdf']);

/** The largest image the renderer will be handed in one piece. */
const MAX_BYTES = 64 * 1024 * 1024;

async function sniff(path: string, size: number): Promise<Uint8Array> {
  const handle = await open(path, 'r');
  try {
    const length = Math.min(SNIFF_BYTES, size);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, 0);
    return new Uint8Array(buffer);
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
  return new Uint8Array(await readFile(path));
}

/** The most one lazily loaded fold may fetch (v0.2.8). */
export const MAX_RANGE_BYTES = 4 * 1024 * 1024;

/**
 * Text from a byte range, for large-file mode's folds (v0.2.8).
 *
 * Decoded as UTF-8 rather than through `decodeText`: this is a slice from the middle
 * of a file, where there is no byte-order mark to find and a UTF-16 file has already
 * been refused by the engine.
 */
export async function readRangeText(path: string, start: number, end: number): Promise<string> {
  const span = end - start;
  if (span <= 0) return '';
  if (span > MAX_RANGE_BYTES) {
    throw new Error(
      `That range is ${(span / 1024 / 1024).toFixed(0)} MB — more than one section can load at once.`,
    );
  }

  const handle = await open(path, 'r');
  try {
    const buffer = Buffer.alloc(span);
    const { bytesRead } = await handle.read(buffer, 0, span, start);
    return new TextDecoder('utf-8').decode(buffer.subarray(0, bytesRead));
  } finally {
    await handle.close();
  }
}

export async function readInput(side: 'A' | 'B', path: string): Promise<InputPayload> {
  const info = await stat(path);
  const name = basename(path) || path;

  if (info.isDirectory()) {
    return { side, kind: 'folder', name: `${name}/`, path, size: 0 };
  }

  const head = info.size > 0 ? await sniff(path, info.size) : new Uint8Array();
  // Decode first, sniff second: a UTF-16 file is full of NUL bytes and would
  // otherwise be written off as binary before anyone tried to read it.
  const decoded = decodeText(head);
  const detected = detectKind({ name, text: decoded.text, kind: 'unknown' });

  // A format we can read is never "binary", however many NUL bytes it contains.
  const kind = READABLE_BINARY.has(detected)
    ? detected
    : looksBinaryText(decoded.text)
      ? 'binary'
      : detected;
  const lang = languageOf(name);

  // An encoding and a line ending describe *text*. A PDF has neither in any sense
  // the status bar means, and reporting "Latin-1 · lossy" for one is noise.
  const opaque = READABLE_BINARY.has(kind) || kind === 'binary';

  const meta = {
    ...(lang !== undefined ? { lang } : {}),
    ...(opaque ? {} : { encoding: describeEncoding(decoded.encoding), eol: decoded.eol }),
  };

  // Nothing opaque is inlined: its bytes are not text, so decoding them would carry
  // megabytes of mojibake across IPC for a preview no view would ever show. The
  // engines that read these formats take a path and read it themselves.
  const inlineable = info.size <= INLINE_LIMIT_BYTES && !opaque && kind !== 'folder';

  if (!inlineable) {
    return {
      side,
      kind,
      name,
      path,
      size: info.size,
      ...meta,
      ...(info.size > INLINE_LIMIT_BYTES ? { large: true } : {}),
    };
  }

  // Small text: read it once here so the renderer can preview it immediately.
  const full = decodeText(new Uint8Array(await readFile(path)));

  return {
    side,
    kind: detectKind({ name, text: full.text, kind: 'unknown' }),
    name,
    path,
    size: info.size,
    text: full.text,
    ...(lang !== undefined ? { lang } : {}),
    encoding: describeEncoding(full.encoding),
    eol: full.eol,
    ...(full.lossy ? { lossy: true } : {}),
  };
}
