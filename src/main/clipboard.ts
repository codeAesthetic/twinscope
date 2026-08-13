import { app, clipboard } from 'electron';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { detectKind } from '../engines/detect';
import type { ClipboardSignature, InputPayload } from '../shared/channels';

/**
 * Reads the system clipboard into a comparison input (MD §34).
 *
 * This is the workflow that makes TwinScope worth keeping open: copy, ⌘⇧V, copy
 * again, ⌘⇧V, done. Text and images are both handled; an image is spilled to a
 * temp file because the image engine works from a path, not a data URL.
 */

/** Clipboard images land here so the engine host can read them by path. */
async function spillImage(png: Buffer): Promise<string> {
  const dir = await mkdtemp(join(app.getPath('temp') || tmpdir(), 'twinscope-clip-'));
  const path = join(dir, `clipboard-${Date.now()}.png`);
  await writeFile(path, png);
  return path;
}

export async function readClipboard(side: 'A' | 'B'): Promise<InputPayload | null> {
  // Image first: a copied screenshot often also carries a text representation,
  // and the image is what the user meant.
  const image = clipboard.readImage();
  if (!image.isEmpty()) {
    const png = image.toPNG();
    const path = await spillImage(png);
    const { width, height } = image.getSize();

    return {
      side,
      kind: 'image',
      name: `clipboard-${side.toLowerCase()}.png`,
      path,
      size: png.byteLength,
      lang: `${width}×${height}`,
    };
  }

  const text = clipboard.readText();
  if (text.trim().length === 0) return null;

  // The name is a hint for the UI only; detection works off the content.
  const kind = detectKind({ name: 'clipboard', text, kind: 'unknown' });
  const extension = kind === 'json' ? 'json' : 'txt';

  return {
    side,
    kind,
    name: `clipboard-${side.toLowerCase()}.${extension}`,
    size: Buffer.byteLength(text, 'utf8'),
    text,
  };
}

export function writeClipboard(text: string): void {
  clipboard.writeText(text);
}

/**
 * A cheap fingerprint of the clipboard, for the opt-in watcher (v0.2.14).
 *
 * Deliberately not `readClipboard`: that decodes an image and writes it to a temp
 * file, which is exactly what a poll loop must not do — several times a second, for
 * content the user has not offered. This reads the length and a few characters, so
 * "something changed" is detectable without the content being ingested.
 */
export function clipboardSignature(): ClipboardSignature {
  const text = clipboard.readText();
  if (text !== '') {
    const head = text.slice(0, 24);
    const tail = text.length > 48 ? text.slice(-24) : '';
    return { kind: 'text', size: text.length, hint: `${head}${tail}` };
  }

  const image = clipboard.readImage();
  if (!image.isEmpty()) {
    const { width, height } = image.getSize();
    return { kind: 'image', size: width * height, hint: `${width}x${height}` };
  }

  return { kind: 'empty', size: 0, hint: '' };
}
