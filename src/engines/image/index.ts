import {
  clusterRegions,
  MAX_DIMENSION,
  padTo,
  paintMask,
  pixelDiff,
  type ImageRegion,
} from './pixelDiff';
import { deltaScore, radarFrom } from '../radar';
import { EngineInputError, type DiffEngine, type DiffResult, type InputRef } from '../types';

export type { ImageRegion, PixelDiffOptions } from './pixelDiff';
export { clusterRegions, pixelDiff, paintMask, padTo, MAX_DIMENSION } from './pixelDiff';

export interface ImageDiffOptions {
  /** 0.01–0.5. Lower is stricter. */
  threshold: number;
  showRegions: boolean;
}

export const DEFAULT_IMAGE_OPTIONS: ImageDiffOptions = {
  threshold: 0.12,
  showRegions: true,
};

export interface ImageDiffData {
  /** Percentage of pixels that differ. */
  pct: number;
  diffPixels: number;
  totalPixels: number;
  regions: ImageRegion[];
  /** Natural dimensions, before any downscale. */
  dims: { before: [number, number]; after: [number, number] };
  sameSize: boolean;
  /** The size actually compared, after padding and downscale. */
  compared: [number, number];
  /**
   * Each side's size *within* the compared canvas, after downscale but before
   * padding. The view needs this to lay a smaller image out at its own size
   * against the union rather than stretching it to fill one.
   */
  scaled: { before: [number, number]; after: [number, number] };
  /** `data:` URL of the difference heatmap. */
  maskUrl: string;
}

async function bytesFor(input: InputRef, read: (path: string) => Promise<Uint8Array>) {
  if (input.path === undefined) throw new Error(`${input.name} has no readable image data.`);
  return read(input.path);
}

/**
 * Visual comparison (MD §8.4).
 *
 * The decoder is injected (`ctx.image`) because there is no portable one: this
 * engine only owns the pixel maths. `ctx.yieldNow` is awaited between bands of
 * work so a single-threaded host stays responsive while a 4K pair is compared.
 */
export const imageEngine: DiffEngine<ImageDiffOptions, ImageDiffData> = {
  meta: { id: 'image', label: 'Visual / pixel diff', priority: 30 },

  canHandle: (a, b) => a.kind === 'image' && b.kind === 'image',

  defaultOptions: () => ({ ...DEFAULT_IMAGE_OPTIONS }),

  async compare(a, b, options, ctx): Promise<DiffResult<ImageDiffData>> {
    const startedAt = Date.now();

    if (ctx.image === undefined) {
      throw new EngineInputError(
        'Images are compared in the app window, which is not available here.',
      );
    }
    if (ctx.fs === undefined) throw new Error('No filesystem access was provided.');

    const read = (path: string): Promise<Uint8Array> =>
      (ctx.fs as NonNullable<typeof ctx.fs>).readBytes(path);

    ctx.progress(10, 'reading');
    const [bytesA, bytesB] = await Promise.all([bytesFor(a, read), bytesFor(b, read)]);

    ctx.progress(25, 'decoding');
    let before;
    let after;
    try {
      [before, after] = await Promise.all([
        ctx.image.decode(bytesA, MAX_DIMENSION),
        ctx.image.decode(bytesB, MAX_DIMENSION),
      ]);
    } catch (cause) {
      // The *host* owns the format list, not the engine: the window decodes
      // whatever Chromium can, and v0.2.2's CLI decodes PNG only. Hard-coding
      // "PNG, JPEG, WebP, GIF and AVIF" here made the CLI advertise four formats
      // it cannot read, so a host that explains itself is passed through.
      const detail = cause instanceof Error && cause.message !== '' ? cause.message : '';
      throw new EngineInputError(
        detail === '' ? 'One of these images could not be decoded.' : detail,
      );
    }

    if (ctx.signal.aborted) throw new DOMException('Comparison cancelled', 'AbortError');

    // Different sizes still compare: pad both onto the union so the extra area
    // reads as changed, which is the truth.
    const width = Math.max(before.width, after.width);
    const height = Math.max(before.height, after.height);
    const leftPixels = padTo(before, width, height);
    const rightPixels = padTo(after, width, height);

    ctx.progress(55, 'comparing pixels');
    await ctx.yieldNow?.();

    const { mask, diffPixels } = pixelDiff(leftPixels, rightPixels, width, height, {
      threshold: options.threshold,
    });

    if (ctx.signal.aborted) throw new DOMException('Comparison cancelled', 'AbortError');

    ctx.progress(78, 'finding regions');
    await ctx.yieldNow?.();
    const regions = clusterRegions(mask, width, height);

    ctx.progress(90, 'rendering difference');
    await ctx.yieldNow?.();
    const maskUrl = await ctx.image.encodePng({
      width,
      height,
      data: paintMask(leftPixels, mask, width, height),
    });

    const totalPixels = width * height;
    const pct = totalPixels === 0 ? 0 : (diffPixels / totalPixels) * 100;
    const sameSize =
      before.natural[0] === after.natural[0] && before.natural[1] === after.natural[1];

    const notes: string[] = [];
    if (!sameSize) {
      notes.push(
        `Dimensions differ (${before.natural[0]}×${before.natural[1]} vs ${after.natural[0]}×${after.natural[1]}) — compared on the union.`,
      );
    }
    if (before.natural[0] > before.width || after.natural[0] > after.width) {
      notes.push(`Scaled down to ${MAX_DIMENSION}px on the longest side before comparing.`);
    }
    notes.push(`Pixels differing by more than ${Math.round(options.threshold * 100)}% counted.`);

    ctx.progress(100, 'done');

    return {
      engineId: 'image',
      summary: {
        // A pixel diff has no notion of added or removed: everything it finds is
        // a modification, and the strip's extras carry the numbers that matter.
        added: 0,
        removed: 0,
        // Never zero while pixels differ. `clusterRegions` works on a coarse grid,
        // so an image smaller than one cell — or a difference spread too thinly to
        // cluster — yields no regions, and reporting "0 modified" alongside
        // "100.00% difference" is a contradiction. It also mattered beyond the
        // strip: v0.2.2's CLI derives its exit code from these three counts, and
        // would have called two visibly different images identical.
        modified: diffPixels > 0 ? Math.max(1, regions.length) : 0,
        extra: {
          difference: `${pct.toFixed(2)}%`,
          regions: regions.length,
          // Reads as "size mismatch" in the strip, which renders `value label`.
          ...(sameSize ? {} : { mismatch: 'size' }),
        },
        // Radar (v0.2.7). The one engine with a real Visual number, and the only
        // axes it can honestly fill: a picture has no keys, licences or types.
        // Structure is the *shape* changing; weight is the pixel count.
        radar: radarFrom({
          visual: Math.round(Math.min(100, pct)),
          // Binary on purpose: an image's structure either changed shape or it did
          // not, and a partial score would imply a scale that does not exist.
          structure: sameSize ? 0 : 100,
          performance: deltaScore(
            before.natural[0] * before.natural[1],
            after.natural[0] * after.natural[1],
          ),
        }),
      },
      data: {
        pct,
        diffPixels,
        totalPixels,
        regions,
        dims: { before: before.natural, after: after.natural },
        sameSize,
        compared: [width, height],
        scaled: {
          before: [before.width, before.height],
          after: [after.width, after.height],
        },
        maskUrl,
      },
      normalizationNotes: notes,
      timings: { ms: Date.now() - startedAt },
    };
  },
};
