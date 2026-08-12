#!/usr/bin/env node
/**
 * Draws the app icon (MD §50): two panels, one changed line each side.
 *
 * Procedural rather than a checked-in binary, and dependency-free: the mark is
 * geometry, the colours come from the design tokens, and PNG is a header plus a
 * deflate stream. Supersampled 4× and box-filtered down, which is what gives the
 * rounded corners clean edges without an SVG rasteriser.
 *
 *   node scripts/make-icon.mjs
 *
 * electron-builder derives the .icns and .ico from the 1024px master, so this is
 * the only image the repo needs.
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SIZE = 1024;
const SCALE = 4;
const W = SIZE * SCALE;

/** From src/renderer/src/styles/tokens.css — the icon is part of the system. */
const BG = [11, 13, 18, 255];
const PANEL = [23, 29, 38, 255];
const ACCENT = [124, 108, 255, 255];
const ADD = [63, 185, 80, 255];
const DEL = [248, 87, 79, 255];

const canvas = new Uint8Array(W * W * 4);

function put(x, y, [r, g, b, a]) {
  if (x < 0 || y < 0 || x >= W || y >= W) return;
  const at = (y * W + x) * 4;
  // Source-over, so a translucent colour lands on what is already there.
  const alpha = a / 255;
  canvas[at] = canvas[at] * (1 - alpha) + r * alpha;
  canvas[at + 1] = canvas[at + 1] * (1 - alpha) + g * alpha;
  canvas[at + 2] = canvas[at + 2] * (1 - alpha) + b * alpha;
  canvas[at + 3] = Math.max(canvas[at + 3], a);
}

function roundedRect(x0, y0, x1, y1, radius, colour) {
  for (let y = Math.floor(y0); y < y1; y += 1) {
    for (let x = Math.floor(x0); x < x1; x += 1) {
      const dx = Math.max(x0 + radius - x, 0, x - (x1 - radius));
      const dy = Math.max(y0 + radius - y, 0, y - (y1 - radius));
      if (dx * dx + dy * dy > radius * radius) continue;
      put(x, y, colour);
    }
  }
}

const unit = (value) => Math.round((value / 1024) * W);

// The tile itself.
roundedRect(0, 0, W, W, unit(230), BG);

// Two panels, split down the middle — the product in one glyph.
const inset = unit(150);
const gap = unit(34);
const top = unit(190);
const bottom = W - unit(190);
const middle = W / 2;

roundedRect(inset, top, middle - gap / 2, bottom, unit(28), PANEL);
roundedRect(middle + gap / 2, top, W - inset, bottom, unit(28), PANEL);

// A line each side: removed on the left, added on the right. Colour alone never
// carries meaning in the app, and the icon keeps the same discipline — the two
// bars differ in position as well as in hue.
const barHeight = unit(52);
const barInset = unit(36);
roundedRect(
  inset + barInset,
  top + unit(150),
  middle - gap / 2 - barInset,
  top + unit(150) + barHeight,
  unit(14),
  DEL,
);
roundedRect(
  middle + gap / 2 + barInset,
  top + unit(250),
  W - inset - barInset,
  top + unit(250) + barHeight,
  unit(14),
  ADD,
);

// The seam: what the app is actually about.
roundedRect(middle - unit(7), top - unit(40), middle + unit(7), bottom + unit(40), unit(7), ACCENT);

/** Box-filter down to the master size, which is what smooths the curves. */
function downsample() {
  const out = new Uint8Array(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const sums = [0, 0, 0, 0];
      for (let sy = 0; sy < SCALE; sy += 1) {
        for (let sx = 0; sx < SCALE; sx += 1) {
          const at = ((y * SCALE + sy) * W + (x * SCALE + sx)) * 4;
          for (let channel = 0; channel < 4; channel += 1) sums[channel] += canvas[at + channel];
        }
      }
      const at = (y * SIZE + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        out[at + channel] = Math.round(sums[channel] / (SCALE * SCALE));
      }
    }
  }
  return out;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function png(pixels, size) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  let at = 0;
  for (let y = 0; y < size; y += 1) {
    raw[at++] = 0;
    for (let x = 0; x < size * 4; x += 1) raw[at++] = pixels[(y * size * 4 + x) | 0];
  }

  const chunk = (type, body) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(body.length);
    const typed = Buffer.concat([Buffer.from(type, 'ascii'), body]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(typed));
    return Buffer.concat([length, typed, crc]);
  };

  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, 'build', 'icon.png');
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, png(downsample(), SIZE));
console.log(`icon → ${target} (${SIZE}×${SIZE})`);
