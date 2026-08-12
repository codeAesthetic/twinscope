import { deflateSync } from 'node:zlib';

/**
 * A minimal truecolour-with-alpha PNG encoder, so the image fixtures can be
 * *generated* rather than committed as binaries.
 *
 * The repo keeps no generated binaries in git (see `scripts/make-icon.mjs` and
 * `build/icon.png`), and a pinned drawing function is every bit as deterministic
 * as a committed file: the same code produces the same bytes on every run.
 *
 * Same approach as `e2e/regression/image-diff.spec.ts` — a real encoder bought
 * for two flat drawings would be a dependency nobody else needs.
 */

export type Rgba = [number, number, number, number];

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = (CRC_TABLE[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, body: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length);
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, crc]);
}

export function encodePng(
  width: number,
  height: number,
  paint: (x: number, y: number) => Rgba,
): Buffer {
  const raw = Buffer.alloc(height * (width * 4 + 1));
  let at = 0;
  for (let y = 0; y < height; y += 1) {
    raw[at++] = 0; // filter: none
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a] = paint(x, y);
      raw[at++] = r;
      raw[at++] = g;
      raw[at++] = b;
      raw[at++] = a;
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: RGBA

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  fill: Rgba;
}

/** Painter for a stack of rectangles: the last box covering a pixel wins. */
export function boxes(background: Rgba, list: readonly Box[]): (x: number, y: number) => Rgba {
  return (x, y) => {
    for (let index = list.length - 1; index >= 0; index -= 1) {
      const box = list[index] as Box;
      if (x >= box.x && x < box.x + box.w && y >= box.y && y < box.y + box.h) return box.fill;
    }
    return background;
  };
}
