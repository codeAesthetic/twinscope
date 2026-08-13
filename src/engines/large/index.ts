import { alignBlocks, uniqueAnchors } from './anchors';
import { blockFirstLine, blockLineCount, buildIndex } from './lineIndex';
import { radarFrom, ratioScore } from '../radar';
import { DEFAULT_TEXT_OPTIONS, diffText } from '../text/textDiff';
import { EngineInputError } from '../types';
import type { AlignedSpan } from './anchors';
import type { BlockIndex, RangeReader } from './lineIndex';
import type { TextDiffData, TextDiffOptions, TextDiffStats, TextRow } from '../text/textDiff';
import type { DiffEngine, DiffResult, HostFs, InputRef } from '../types';

/**
 * Large-file mode (v0.2.8, MD §31) — the same row model, over files it never holds.
 *
 * The shape of the answer is unchanged: this engine emits `TextRow[]`, so
 * `TextDiffView` renders it with the same three view modes, the same search and the
 * same change navigation. What changes is how the rows are arrived at:
 *
 *  1. **Index, don't read.** `lineIndex` scans raw bytes for newlines and hashes each
 *     64-line block. A 1 GB file becomes a few megabytes of offsets and hashes.
 *  2. **Anchor on hashes unique to both sides**, then take the longest increasing
 *     subsequence — `anchors.ts` explains why an LCS is out of the question here.
 *  3. **Diff only the gaps.** Each unmatched span is a window: read those bytes on
 *     both sides and hand them to the ordinary `diffText`, then shift the line
 *     numbers. Matched spans are folds carrying a byte range, fetched only if the
 *     reader opens one.
 *
 * It is a separate engine rather than a flag on `text` because the two have
 * incompatible memory profiles, and `text`'s 200 000-line guard is correct for the
 * sizes it accepts. Everything it cannot do it says out loud: three caps, each with
 * a note, because silent truncation in a large-file mode reads as "nothing else
 * changed".
 */

/** Either side above this and the pair belongs to this engine, not to `text`. */
export const LARGE_BYTES = 8 * 1024 * 1024;

/** Combined lines in one window that still diff line by line. */
const MAX_WINDOW_LINES = 20_000;

/** Rows in the whole result. Past this, windows stop being diffed. */
const MAX_ROWS = 80_000;

/**
 * The largest span one fold may cover, kept under the view's load cap (4 MB) so
 * that every fold this engine emits can actually be opened.
 */
const FOLD_MAX_BYTES = 3 * 1024 * 1024;

/** Kinds a line diff can read, matching the text engine's set. */
const COMPARABLE = new Set(['text', 'code', 'json', 'yaml', 'csv', 'md', 'api', 'unknown']);

const FALLBACK = { fallbackEngineId: 'text', fallbackLabel: 'Compare as text' };

function readerFor(fs: HostFs, path: string, size: number): RangeReader {
  return {
    size,
    read: async (start, length) => {
      if (fs.readRange === undefined) {
        throw new EngineInputError(
          'This host cannot read part of a file, which large-file mode needs.',
          FALLBACK,
        );
      }
      return fs.readRange(path, start, length);
    },
  };
}

/**
 * UTF-16 has to be refused rather than mis-read.
 *
 * Every ASCII character in a UTF-16 file is a byte and a NUL, so a scanner looking
 * for `0x0A` finds every newline and also produces text with a NUL between every
 * two characters. The result would look like a successful comparison of nonsense,
 * which is worse than a refusal.
 */
function looksUtf16(head: Uint8Array): boolean {
  if (head.length >= 2) {
    const [first, second] = [head[0] as number, head[1] as number];
    if ((first === 0xff && second === 0xfe) || (first === 0xfe && second === 0xff)) return true;
  }
  const sample = head.subarray(0, Math.min(head.length, 64));
  if (sample.length < 16) return false;
  let nuls = 0;
  for (const byte of sample) if (byte === 0) nuls += 1;
  return nuls > sample.length / 4;
}

/** Shifts a window's line numbers into the whole file's numbering. */
function offsetRows(rows: readonly TextRow[], left: number, right: number): TextRow[] {
  return rows.map((row) => ({
    ...row,
    ...(row.left !== undefined ? { left: row.left + left } : {}),
    ...(row.right !== undefined ? { right: row.right + right } : {}),
    ...(row.hidden !== undefined ? { hidden: offsetRows(row.hidden, left, right) } : {}),
  }));
}

/**
 * A window's text, with the newline that terminates its last line removed.
 *
 * A block range ends immediately after a newline, so splitting the slice as-is
 * yields a phantom empty line at the end of every window.
 */
function decodeWindow(bytes: Uint8Array): string {
  const text = new TextDecoder('utf-8').decode(bytes);
  return text.endsWith('\n') ? text.slice(0, -1) : text;
}

async function readSpan(
  reader: RangeReader,
  index: BlockIndex,
  start: number,
  end: number,
): Promise<string> {
  if (end <= start) return '';
  const from = index.offsets[start] as number;
  const to = index.offsets[end] as number;
  if (to <= from) return '';
  return decodeWindow(await reader.read(from, to - from));
}

export const largeTextEngine: DiffEngine<TextDiffOptions, TextDiffData> = {
  // Above `text` (0) and below every structural engine: a 20 MB JSON pair is still
  // better served by a structural comparison, and this engine stays one dropdown
  // pick away when it is not.
  meta: { id: 'text-large', label: 'Large text diff', priority: 5 },

  canHandle: (a, b) =>
    COMPARABLE.has(a.kind) &&
    COMPARABLE.has(b.kind) &&
    a.path !== undefined &&
    b.path !== undefined &&
    (a.size > LARGE_BYTES || b.size > LARGE_BYTES),

  defaultOptions: () => ({ ...DEFAULT_TEXT_OPTIONS }),

  async compare(a, b, options, ctx): Promise<DiffResult<TextDiffData>> {
    const startedAt = Date.now();
    const fs = ctx.fs;
    if (fs === undefined) throw new Error('No filesystem access was provided.');
    if (fs.readRange === undefined) {
      throw new EngineInputError(
        'This host cannot read part of a file, which large-file mode needs.',
        FALLBACK,
      );
    }

    const pathA = pathOf(a);
    const pathB = pathOf(b);

    const [statA, statB] = await Promise.all([fs.stat(pathA), fs.stat(pathB)]);
    const readerA = readerFor(fs, pathA, statA.size);
    const readerB = readerFor(fs, pathB, statB.size);

    const heads = await Promise.all([
      readerA.read(0, Math.min(64, statA.size)),
      readerB.read(0, Math.min(64, statB.size)),
    ]);
    if (heads.some(looksUtf16)) {
      throw new EngineInputError(
        'Large-file mode reads UTF-8 and ASCII; this file looks like UTF-16.',
        FALLBACK,
      );
    }

    ctx.progress(5, 'indexing');
    const notes: string[] = [];

    const indexA = await buildIndex(readerA, {
      signal: ctx.signal,
      onProgress: (fraction) => ctx.progress(5 + fraction * 25, 'indexing before'),
    });
    const indexB = await buildIndex(readerB, {
      signal: ctx.signal,
      onProgress: (fraction) => ctx.progress(30 + fraction * 25, 'indexing after'),
    });

    const lines = Math.max(indexA.lines, indexB.lines);
    const identical =
      indexA.bytes === indexB.bytes &&
      indexA.hashes.length === indexB.hashes.length &&
      indexA.hashes.every((hash, at) => hash === indexB.hashes[at]);

    if (identical) {
      ctx.progress(100, 'done');
      return {
        engineId: 'text-large',
        summary: { added: 0, removed: 0, modified: 0, extra: { lines } },
        data: { rows: [], lines: { before: indexA.lines, after: indexB.lines } },
        normalizationNotes: [
          `These inputs are identical — ${indexA.hashes.length} blocks of ${indexA.blockLines} lines match byte for byte.`,
        ],
        timings: { ms: Date.now() - startedAt },
      };
    }

    ctx.progress(58, 'aligning blocks');
    const anchors = uniqueAnchors(indexA.hashes, indexB.hashes);
    const spans = alignBlocks(anchors, indexA.hashes.length, indexB.hashes.length);

    const rows: TextRow[] = [];
    const stats: TextDiffStats = { added: 0, removed: 0, modified: 0 };
    let windows = 0;
    let oversized = 0;
    let truncatedAt = -1;

    for (let at = 0; at < spans.length; at += 1) {
      if (ctx.signal.aborted) throw new DOMException('Comparison cancelled', 'AbortError');
      const span = spans[at] as AlignedSpan;
      ctx.progress(58 + (at / spans.length) * 40, 'comparing windows');

      if (span.kind === 'same') {
        rows.push(...foldsFor(span, indexA, indexB, pathA));
        continue;
      }

      const aLines = blockLineCount(indexA, span.aStart, span.aEnd);
      const bLines = blockLineCount(indexB, span.bStart, span.bEnd);

      if (rows.length >= MAX_ROWS) {
        truncatedAt = truncatedAt === -1 ? at : truncatedAt;
        stats.removed += aLines;
        stats.added += bLines;
        continue;
      }

      if (aLines + bLines > MAX_WINDOW_LINES) {
        oversized += 1;
        stats.removed += aLines;
        stats.added += bLines;
        rows.push({
          kind: 'fold',
          left: blockFirstLine(indexA, span.aStart),
          right: blockFirstLine(indexB, span.bStart),
          text: '',
          count: aLines + bLines,
          note: `${aLines.toLocaleString()} lines before ／ ${bLines.toLocaleString()} lines after — this region is too large to diff line by line`,
        });
        continue;
      }

      const [before, after] = await Promise.all([
        readSpan(readerA, indexA, span.aStart, span.aEnd),
        readSpan(readerB, indexB, span.bStart, span.bEnd),
      ]);

      windows += 1;
      const window = diffText(before, after, options);
      stats.added += window.stats.added;
      stats.removed += window.stats.removed;
      stats.modified += window.stats.modified;
      rows.push(
        ...offsetRows(
          window.data.rows,
          blockFirstLine(indexA, span.aStart) - 1,
          blockFirstLine(indexB, span.bStart) - 1,
        ),
      );
    }

    ctx.progress(100, 'done');

    notes.push(
      `Indexed in blocks of ${indexA.blockLines} lines and anchored on ${anchors.length.toLocaleString()} blocks that match byte for byte on both sides.`,
      'Anchoring is byte-exact, so a block whose lines differ only by case, whitespace or line endings is compared as a changed region rather than skipped.',
      `Compared ${windows.toLocaleString()} changed region${windows === 1 ? '' : 's'} in full; unchanged regions are folds that load their lines from disk when opened.`,
    );
    if (oversized > 0) {
      notes.push(
        `${oversized} region${oversized === 1 ? ' was' : 's were'} too large to diff line by line; ${oversized === 1 ? 'its' : 'their'} lines are counted as removed and added rather than paired.`,
      );
    }
    if (truncatedAt !== -1) {
      rows.push({
        kind: 'fold',
        text: '',
        count: 0,
        note: `Stopped after ${MAX_ROWS.toLocaleString()} rows — ${(spans.length - truncatedAt).toLocaleString()} later regions are counted but not shown`,
      });
      notes.push(
        `The result was capped at ${MAX_ROWS.toLocaleString()} rows. Later regions are counted in the totals but not rendered.`,
      );
    }

    return {
      engineId: 'text-large',
      summary: {
        added: stats.added,
        removed: stats.removed,
        modified: stats.modified,
        extra: {
          lines,
          windows,
          blocks: Math.max(indexA.hashes.length, indexB.hashes.length),
        },
        // The same two axes the text engine can measure, from the same counts. The
        // other four are absent, not zero — a line diff knows nothing about them.
        radar: radarFrom({
          structure: ratioScore(stats.added + stats.removed, lines),
          content: ratioScore(stats.modified, lines),
        }),
      },
      data: { rows, lines: { before: indexA.lines, after: indexB.lines } },
      normalizationNotes: notes,
      timings: { ms: Date.now() - startedAt },
    };
  },
};

/**
 * An aligned span as folds small enough to open.
 *
 * One fold per span would be simpler and was the first attempt, but a matched run
 * of 9 MB then produces a single fold the view can only label "too large to load" —
 * so most of a file with few changes would be permanently shut. Splitting on a byte
 * budget means every fold in the result is openable, at the cost of a few extra
 * rows in a place where rows are cheap.
 */
function foldsFor(
  span: AlignedSpan,
  indexA: BlockIndex,
  indexB: BlockIndex,
  path: string,
): TextRow[] {
  const out: TextRow[] = [];
  let from = span.aStart;

  for (let block = span.aStart + 1; block <= span.aEnd; block += 1) {
    const bytes = (indexA.offsets[block] as number) - (indexA.offsets[from] as number);
    const last = block === span.aEnd;
    if (!last && bytes < FOLD_MAX_BYTES) continue;

    const count = blockLineCount(indexA, from, block);
    if (count > 0) {
      out.push({
        kind: 'fold',
        left: blockFirstLine(indexA, from),
        // The B side's line number for the same content: an aligned span can sit at
        // a different line on each side, which is what an earlier insertion means.
        right: blockFirstLine(indexB, span.bStart + (from - span.aStart)),
        text: '',
        count,
        range: {
          path,
          start: indexA.offsets[from] as number,
          end: indexA.offsets[block] as number,
        },
      });
    }
    from = block;
  }

  return out;
}

function pathOf(input: InputRef): string {
  if (input.path === undefined) {
    throw new EngineInputError(
      `${input.name} has no file on disk, and large-file mode compares files.`,
      FALLBACK,
    );
  }
  return input.path;
}

export { buildIndex } from './lineIndex';
export { alignBlocks, uniqueAnchors } from './anchors';
