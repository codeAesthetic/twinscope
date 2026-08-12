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

export async function readInput(side: 'A' | 'B', path: string): Promise<InputPayload> {
  const info = await stat(path);
  const name = basename(path) || path;

  if (info.isDirectory()) {
    return { side, kind: 'folder', name: `${name}/`, path, size: 0 };
  }

  const head = info.size > 0 ? await sniff(path, info.size) : '';
  const kind = looksBinary(head) ? 'binary' : detectKind({ name, text: head, kind: 'unknown' });
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
