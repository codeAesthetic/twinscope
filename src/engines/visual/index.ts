import { MAX_DIMENSION, padTo, pixelDiff } from '../image/pixelDiff';
import { radarFrom, ratioScore } from '../radar';
import { EngineInputError, EngineUnsupportedError } from '../types';
import type { DiffEngine, DiffResult, EngineCtx } from '../types';

/**
 * Visual regression over two directories of screenshots (v0.3.5, MD §42 / A6).
 *
 * The image engine (MVP-7) answers "do these two pictures differ, and where". A
 * visual-regression run asks a different question: **did any of four hundred
 * screenshots move, and by how much** — one number a pipeline can gate on, plus a
 * list ordered by how badly each shot changed.
 *
 * So this engine is the image engine's pixel maths over a paired directory walk, and
 * nothing else: `pixelDiff` and `padTo` are imported rather than reimplemented, so a
 * fix to the pixel comparison fixes both.
 *
 * **It needs a host with both a filesystem and an image decoder**, which today means
 * the CLI (v0.2.2): the engine worker has no decoder, and the renderer — where the
 * decoder lives — cannot list a directory, and moving a baseline set through IPC as
 * bytes would be exactly what the standing rule forbids. The refusal says so and names
 * the alternative rather than failing obscurely.
 */

export type VisualState = 'same' | 'changed' | 'added' | 'removed' | 'failed';

export interface VisualRow {
  /** Path relative to the folder that was given. */
  path: string;
  state: VisualState;
  /** Percentage of pixels that differ. Absent unless both sides decoded. */
  pct: number | undefined;
  /** Set when a pair could not be compared, with the reason. */
  note: string | undefined;
  dims: { before: [number, number] | undefined; after: [number, number] | undefined };
}

export interface VisualDiffData {
  rows: VisualRow[];
  /** The worst percentage across the set — the number a pipeline gates on. */
  worst: number;
  /** Images differing at all, and images over `perImagePercent`. */
  changed: number;
  overBudget: number;
  roots: { before: string; after: string };
}

export interface VisualDiffOptions {
  /** Per-pixel sensitivity, as in the image engine. 0.01–0.5, lower is stricter. */
  threshold: number;
  /**
   * The share of pixels an image may differ by before it counts as a regression.
   * Anti-aliasing and font rasterisation move a handful of pixels on every run, so
   * zero is the wrong default for a real screenshot suite.
   */
  perImagePercent: number;
  /** Files to skip, as globs against the relative path. */
  ignore: string[];
  /** A hard cap on how many pairs are decoded, so a huge set cannot hang a build. */
  maxImages: number;
}

export const DEFAULT_VISUAL_OPTIONS: VisualDiffOptions = {
  threshold: 0.1,
  perImagePercent: 0.1,
  ignore: [],
  maxImages: 2000,
};

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'bmp']);

/** Recursive walk, relative paths, images only. */
async function collect(
  ctx: EngineCtx,
  root: string,
  prefix = '',
  depth = 0,
  into = new Map<string, string>(),
): Promise<Map<string, string>> {
  if (depth > 24 || ctx.fs === undefined) return into;
  const entries = await ctx.fs.listDir(root);

  for (const entry of entries) {
    if (entry.isSymlink) continue;
    const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory) {
      await collect(ctx, entry.path, relative, depth + 1, into);
      continue;
    }
    const extension = entry.name.toLowerCase().split('.').pop() ?? '';
    if (IMAGE_EXTENSIONS.has(extension)) into.set(relative, entry.path);
  }

  return into;
}

function globToRegExp(glob: string): RegExp {
  const literal = glob.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`^${literal.join('.*')}$`);
}

export const visualEngine: DiffEngine<VisualDiffOptions, VisualDiffData> = {
  // Priority 0: never chosen by detection. Two folders of screenshots and two folders
  // of source code are indistinguishable from the outside, and hijacking every folder
  // comparison to decode its images would be far worse than asking.
  meta: { id: 'visual', label: 'Visual regression', priority: 0 },

  canHandle: (a, b) => a.kind === 'folder' && b.kind === 'folder',

  defaultOptions: () => ({ ...DEFAULT_VISUAL_OPTIONS, ignore: [] }),

  async compare(a, b, options, ctx): Promise<DiffResult<VisualDiffData>> {
    const startedAt = Date.now();

    if (ctx.fs === undefined || ctx.image === undefined) {
      // Not a failure — this host simply cannot host this engine. The command is
      // carried separately so the panel can set it in mono, and it names generic
      // folders rather than these two: a real path here would put whatever
      // directory the reader happened to open into a documentation still.
      throw new EngineUnsupportedError(
        'Visual regression has to list a directory and decode images at once, and no single process in the app can do both.',
        {
          command: 'twinscope baseline/ current/ --engine visual',
          fallback: { fallbackEngineId: 'folder', fallbackLabel: 'Compare as folders' },
        },
      );
    }
    const rootA = a.path;
    const rootB = b.path;
    if (rootA === undefined || rootB === undefined) {
      throw new EngineInputError('Both sides have to be folders on disk.', {
        fallbackEngineId: 'folder',
        fallbackLabel: 'Compare as folders',
      });
    }

    ctx.progress(5, 'listing screenshots');
    const [before, after] = await Promise.all([collect(ctx, rootA), collect(ctx, rootB)]);

    const ignore = options.ignore.map(globToRegExp);
    const paths = [...new Set([...before.keys(), ...after.keys()])]
      .filter((path) => !ignore.some((pattern) => pattern.test(path)))
      .sort();

    const capped = paths.length > options.maxImages;
    const considered = capped ? paths.slice(0, options.maxImages) : paths;

    const rows: VisualRow[] = [];
    let worst = 0;

    for (let at = 0; at < considered.length; at += 1) {
      if (ctx.signal.aborted) throw new DOMException('Comparison cancelled', 'AbortError');
      const path = considered[at] as string;
      ctx.progress(5 + (at / Math.max(1, considered.length)) * 90, `comparing ${path}`);

      const pathA = before.get(path);
      const pathB = after.get(path);

      if (pathA === undefined || pathB === undefined) {
        rows.push({
          path,
          state: pathA === undefined ? 'added' : 'removed',
          pct: undefined,
          note: pathA === undefined ? 'only in the new set' : 'only in the baseline',
          dims: { before: undefined, after: undefined },
        });
        continue;
      }

      try {
        const [bytesA, bytesB] = await Promise.all([
          ctx.fs.readBytes(pathA),
          ctx.fs.readBytes(pathB),
        ]);
        const [imageA, imageB] = await Promise.all([
          ctx.image.decode(bytesA, MAX_DIMENSION),
          ctx.image.decode(bytesB, MAX_DIMENSION),
        ]);

        // Mismatched sizes compare on the union, exactly as the image engine does: a
        // screenshot that grew is a regression, not an error.
        const width = Math.max(imageA.width, imageB.width);
        const height = Math.max(imageA.height, imageB.height);
        const left = padTo(imageA, width, height);
        const right = padTo(imageB, width, height);
        const diff = pixelDiff(left, right, width, height, { threshold: options.threshold });
        // The engine reports pixels; the percentage is this engine's own arithmetic,
        // so a 4000×4000 pair and a 40×40 pair are comparable numbers.
        const pct = width * height === 0 ? 0 : (diff.diffPixels / (width * height)) * 100;

        worst = Math.max(worst, pct);
        rows.push({
          path,
          state: diff.diffPixels === 0 ? 'same' : 'changed',
          pct,
          note: undefined,
          dims: { before: imageA.natural, after: imageB.natural },
        });
      } catch (cause) {
        // One unreadable screenshot must not fail the run: the other 399 still carry
        // the answer, and the failure is a row like any other.
        rows.push({
          path,
          state: 'failed',
          pct: undefined,
          note: cause instanceof Error ? cause.message : String(cause),
          dims: { before: undefined, after: undefined },
        });
      }
    }

    // Worst first: a visual run is read from the top, and the interesting shot is the
    // one that moved most.
    rows.sort(
      (one, other) => (other.pct ?? -1) - (one.pct ?? -1) || one.path.localeCompare(other.path),
    );

    const changed = rows.filter((row) => row.state === 'changed').length;
    const overBudget = rows.filter((row) => (row.pct ?? 0) > options.perImagePercent).length;
    const added = rows.filter((row) => row.state === 'added').length;
    const removed = rows.filter((row) => row.state === 'removed').length;
    const failed = rows.filter((row) => row.state === 'failed').length;

    const notes: string[] = [
      `Compared ${considered.length} screenshot${considered.length === 1 ? '' : 's'} by relative path.`,
      `A pixel counts as different past ${Math.round(options.threshold * 100)}% of a channel, and an image counts as a regression past ${options.perImagePercent}% of its pixels — anti-aliasing moves a handful on every run, so zero is the wrong budget for a real suite.`,
      // Interpolated, not typed out: this said 2000px while `MAX_DIMENSION` was 4096,
      // and it is printed with every result — so the engine was stating a limit that
      // was not its limit. A number in prose beside a constant will drift; the only
      // fix that holds is for the prose to read the constant.
      `Images larger than ${MAX_DIMENSION}px on their longest side are scaled down before comparison, as in the image viewer.`,
    ];
    if (failed > 0) {
      notes.push(
        `${failed} pair${failed === 1 ? '' : 's'} could not be compared and are listed with the reason. The rest of the run still stands.`,
      );
    }
    if (capped) {
      notes.push(
        `${paths.length - options.maxImages} further screenshots were not compared: the run is capped at ${options.maxImages}.`,
      );
    }
    if (options.ignore.length > 0) notes.push(`Ignored: ${options.ignore.join(', ')}.`);

    ctx.progress(100, 'done');

    return {
      engineId: 'visual',
      summary: {
        added,
        removed,
        modified: changed,
        extra: {
          images: considered.length,
          // `worst difference` is what `--max-diff` reads (v0.3.4): one number for a
          // pipeline to gate the whole set on.
          'worst difference': `${worst.toFixed(2)}%`,
          'over budget': overBudget,
          ...(failed > 0 ? { unreadable: failed } : {}),
        },
        radar: radarFrom({
          visual: ratioScore(worst, 100),
          structure: ratioScore(added + removed, Math.max(1, considered.length)),
          content: ratioScore(changed, Math.max(1, considered.length)),
        }),
      },
      data: { rows, worst, changed, overBudget, roots: { before: rootA, after: rootB } },
      normalizationNotes: notes,
      timings: { ms: Date.now() - startedAt },
    };
  },
};
