/**
 * Pixel comparison and region clustering (MD §8.4/§14).
 *
 * Pure maths over RGBA buffers: no canvas, no DOM, no decoder. Whoever calls it
 * supplies decoded pixels, which is what lets the same code run behind the
 * renderer's `createImageBitmap` today and a Node decoder in the CLI later.
 */

export interface PixelDiffOptions {
  /** 0–1. Fraction of the maximum channel distance that counts as a change. */
  threshold: number;
}

export interface PixelDiffResult {
  /** One byte per pixel: 1 where the images differ. */
  mask: Uint8Array;
  diffPixels: number;
}

export interface ImageRegion {
  /** Percentages of the compared canvas, so the view can place them at any zoom. */
  left: number;
  top: number;
  width: number;
  height: number;
  /** Changed pixels inside the region. */
  pixels: number;
  /** Share of the whole image this region covers. */
  areaPct: number;
}

/** Above this the work stops being interactive; the pair is scaled down first. */
export const MAX_DIMENSION = 4096;

/** Sum of the four channel distances at which two pixels are "different". */
function tolerance(threshold: number): number {
  return threshold * 255 * 4;
}

/**
 * Compares two same-sized RGBA buffers.
 *
 * Manhattan distance across all four channels, matching the approved mockup —
 * cheaper than a perceptual metric and, for screenshots and UI captures, it
 * flags the same pixels.
 */
export function pixelDiff(
  before: Uint8ClampedArray,
  after: Uint8ClampedArray,
  width: number,
  height: number,
  options: PixelDiffOptions,
): PixelDiffResult {
  const total = width * height;
  const mask = new Uint8Array(total);
  const limit = tolerance(options.threshold);
  let diffPixels = 0;

  for (let pixel = 0; pixel < total; pixel += 1) {
    const at = pixel * 4;
    const distance =
      Math.abs((before[at] ?? 0) - (after[at] ?? 0)) +
      Math.abs((before[at + 1] ?? 0) - (after[at + 1] ?? 0)) +
      Math.abs((before[at + 2] ?? 0) - (after[at + 2] ?? 0)) +
      Math.abs((before[at + 3] ?? 0) - (after[at + 3] ?? 0));

    if (distance > limit) {
      mask[pixel] = 1;
      diffPixels += 1;
    }
  }

  return { mask, diffPixels };
}

/**
 * Groups changed pixels into rectangles.
 *
 * The mask is reduced to a coarse grid first and the flood fill runs over cells,
 * not pixels: a per-pixel fill on a 4K image is millions of stack operations to
 * produce the same handful of boxes. A cell has to hold a minimum share of
 * changed pixels to count, which is what keeps antialiasing noise from becoming
 * two hundred one-pixel "regions".
 */
export function clusterRegions(
  mask: Uint8Array,
  width: number,
  height: number,
  limit = 24,
): ImageRegion[] {
  const cellWidth = Math.max(1, Math.round(width / 40));
  const cellHeight = Math.max(1, Math.round(height / 40));
  const columns = Math.ceil(width / cellWidth);
  const rows = Math.ceil(height / cellHeight);
  const cells = new Int32Array(columns * rows);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (mask[y * width + x] === 1) {
        cells[Math.floor(y / cellHeight) * columns + Math.floor(x / cellWidth)] += 1;
      }
    }
  }

  const minimum = Math.max(2, Math.round(cellWidth * cellHeight * 0.03));
  const seen = new Uint8Array(cells.length);
  const regions: ImageRegion[] = [];
  const neighbours = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [-1, -1],
    [1, -1],
    [-1, 1],
  ] as const;

  for (let index = 0; index < cells.length; index += 1) {
    if (seen[index] === 1 || (cells[index] ?? 0) < minimum) continue;

    let minX = index % columns;
    let maxX = minX;
    let minY = Math.floor(index / columns);
    let maxY = minY;
    let pixels = 0;

    const queue = [index];
    seen[index] = 1;

    while (queue.length > 0) {
      const cell = queue.pop() as number;
      const cellX = cell % columns;
      const cellY = Math.floor(cell / columns);

      pixels += cells[cell] ?? 0;
      minX = Math.min(minX, cellX);
      maxX = Math.max(maxX, cellX);
      minY = Math.min(minY, cellY);
      maxY = Math.max(maxY, cellY);

      for (const [dx, dy] of neighbours) {
        const nextX = cellX + dx;
        const nextY = cellY + dy;
        if (nextX < 0 || nextY < 0 || nextX >= columns || nextY >= rows) continue;
        const next = nextY * columns + nextX;
        if (seen[next] === 1 || (cells[next] ?? 0) < minimum) continue;
        seen[next] = 1;
        queue.push(next);
      }
    }

    const boxWidth = ((maxX - minX + 1) * cellWidth * 100) / width;
    const boxHeight = ((maxY - minY + 1) * cellHeight * 100) / height;

    regions.push({
      left: (minX * cellWidth * 100) / width,
      top: (minY * cellHeight * 100) / height,
      width: Math.min(boxWidth, 100),
      height: Math.min(boxHeight, 100),
      pixels,
      areaPct: (pixels / (width * height)) * 100,
    });
  }

  return regions.sort((one, two) => two.pixels - one.pixels).slice(0, limit);
}

/** Renders the mask as a heatmap over a dimmed copy of the before image. */
export function paintMask(
  before: Uint8ClampedArray,
  mask: Uint8Array,
  width: number,
  height: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 4);

  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const at = pixel * 4;
    if (mask[pixel] === 1) {
      out[at] = 255;
      out[at + 1] = 79;
      out[at + 2] = 216;
      out[at + 3] = 235;
      continue;
    }
    const grey = ((before[at] ?? 0) + (before[at + 1] ?? 0) + (before[at + 2] ?? 0)) / 3;
    out[at] = grey * 0.22;
    out[at + 1] = grey * 0.22;
    out[at + 2] = grey * 0.22;
    out[at + 3] = 255;
  }

  return out;
}

/**
 * Pads a raster onto a larger canvas with transparent pixels.
 *
 * Mismatched dimensions still deserve an answer: comparing on the union means
 * the extra area shows up as changed, which is exactly what happened.
 */
export function padTo(
  raster: { width: number; height: number; data: Uint8ClampedArray },
  width: number,
  height: number,
): Uint8ClampedArray {
  if (raster.width === width && raster.height === height) return raster.data;

  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < raster.height; y += 1) {
    const from = y * raster.width * 4;
    out.set(raster.data.subarray(from, from + raster.width * 4), y * width * 4);
  }
  return out;
}
