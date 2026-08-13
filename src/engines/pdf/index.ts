import { diffArrays } from 'diff';
import { radarFrom, ratioScore } from '../radar';
import { DEFAULT_TEXT_OPTIONS, diffText, similarity } from '../text/textDiff';
import { EngineInputError } from '../types';
import type { TextDiffOptions, TextRow } from '../text/textDiff';
import type { DiffEngine, DiffResult, InputRef, PdfDocument, PdfPage } from '../types';

/**
 * PDF comparison (v0.3.3, A10) — page by page, by their text.
 *
 * Two decisions shape this engine:
 *
 *  - **Pages pair by content, not by number.** A page inserted at the front shifts
 *    every page after it, and a comparison that paired page 4 against page 4 would
 *    report a whole document as changed. Pages align through `diffArrays` with a
 *    similarity comparator — the same trick `textDiff` uses on lines, one level up.
 *  - **The text comparison is the text engine's.** Each changed page's rows come from
 *    `diffText`, so word-level marks, folding and the normalisation rules all work
 *    inside a page without a second implementation.
 *
 * **The visual half is not here, and the result says so.** Rendering a page needs a
 * rasteriser: a canvas (which lives in the window, where this engine does not run) or
 * a native dependency. What exists instead is a real path — export the pages as PNGs
 * and use the `visual` engine (v0.3.5) — and it is named in the notes rather than left
 * for someone to wonder about.
 */

export type PdfPageState = 'same' | 'changed' | 'added' | 'removed';

export interface PdfPageRow {
  /** Page number on each side, absent where the page exists on one side only. */
  before: number | undefined;
  after: number | undefined;
  state: PdfPageState;
  /** Line rows from `diffText`, for a changed page. */
  rows: TextRow[];
  added: number;
  removed: number;
  modified: number;
  /** Characters of extracted text, which is how "this page is an image" shows up. */
  characters: { before: number; after: number };
  /** Page size in points, when it changed. */
  resized: { before: [number, number]; after: [number, number] } | undefined;
}

export interface PdfDiffData {
  pages: PdfPageRow[];
  counts: { before: number; after: number };
  info: { before: Record<string, string>; after: Record<string, string> };
  /** Metadata fields that differ, e.g. Title or Producer. */
  infoChanges: Array<{ key: string; before: string | undefined; after: string | undefined }>;
  /** Pages with no extractable text at all — scans, or pages that are one image. */
  imageOnly: number;
}

export interface PdfDiffOptions extends TextDiffOptions {
  /** A cap, so a 4000-page document cannot hang a comparison. */
  maxPages: number;
  /** Compare the document's metadata (Title, Author, Producer…). */
  compareMetadata: boolean;
}

export const DEFAULT_PDF_OPTIONS: PdfDiffOptions = {
  ...DEFAULT_TEXT_OPTIONS,
  maxPages: 500,
  compareMetadata: true,
};

/** Pages this similar are the same page, edited. Lower than a line's, deliberately. */
const PAGE_SIMILARITY = 0.5;

const FALLBACK = { fallbackEngineId: 'binary', fallbackLabel: 'Compare as files' };

function normalise(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Pairs pages by content, so an inserted page shifts nothing after it. */
export function alignPages(
  before: readonly PdfPage[],
  after: readonly PdfPage[],
): Array<{ before: PdfPage | undefined; after: PdfPage | undefined }> {
  const chunks = diffArrays(
    before.map((page) => normalise(page.text)),
    after.map((page) => normalise(page.text)),
    { comparator: (left, right) => left === right || similarity(left, right) > PAGE_SIMILARITY },
  );

  const pairs: Array<{ before: PdfPage | undefined; after: PdfPage | undefined }> = [];
  let leftAt = 0;
  let rightAt = 0;

  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index]!;

    if (chunk.added !== true && chunk.removed !== true) {
      for (let step = 0; step < chunk.value.length; step += 1) {
        pairs.push({ before: before[leftAt], after: after[rightAt] });
        leftAt += 1;
        rightAt += 1;
      }
      continue;
    }

    const removed = chunk.removed === true ? chunk.value.length : 0;
    let added = chunk.added === true ? chunk.value.length : 0;
    const next = chunks[index + 1];
    if (chunk.removed === true && next?.added === true) {
      added = next.value.length;
      index += 1;
    }

    // A removal followed by an addition is a rewritten page while both sides have
    // one; past that, whichever side ran out has the page missing.
    const paired = Math.min(removed, added);
    for (let step = 0; step < paired; step += 1) {
      pairs.push({ before: before[leftAt], after: after[rightAt] });
      leftAt += 1;
      rightAt += 1;
    }
    for (let step = paired; step < removed; step += 1) {
      pairs.push({ before: before[leftAt], after: undefined });
      leftAt += 1;
    }
    for (let step = paired; step < added; step += 1) {
      pairs.push({ before: undefined, after: after[rightAt] });
      rightAt += 1;
    }
  }

  return pairs;
}

function bytesOf(input: InputRef): string {
  if (input.path === undefined) {
    throw new EngineInputError(`${input.name} is not a file on disk.`, FALLBACK);
  }
  return input.path;
}

export const pdfEngine: DiffEngine<PdfDiffOptions, PdfDiffData> = {
  meta: { id: 'pdf', label: 'PDF diff', priority: 65 },

  canHandle: (a, b) => a.kind === 'pdf' && b.kind === 'pdf',

  defaultOptions: () => ({ ...DEFAULT_PDF_OPTIONS }),

  async compare(a, b, options, ctx): Promise<DiffResult<PdfDiffData>> {
    const startedAt = Date.now();

    if (ctx.fs === undefined || ctx.pdf === undefined) {
      throw new EngineInputError(
        'This host cannot read a PDF. The desktop app and the command line both can.',
        FALLBACK,
      );
    }

    ctx.progress(10, 'reading pages');
    let documents: [PdfDocument, PdfDocument];
    try {
      documents = await Promise.all([
        ctx.pdf.read(await ctx.fs.readBytes(bytesOf(a)), options.maxPages),
        ctx.pdf.read(await ctx.fs.readBytes(bytesOf(b)), options.maxPages),
      ]);
    } catch (cause) {
      // An encrypted or corrupt document is a real answer, and the binary engine can
      // still say whether the two files are the same bytes.
      throw new EngineInputError(
        `Could not read one of these as a PDF: ${cause instanceof Error ? cause.message : String(cause)}`,
        FALLBACK,
      );
    }

    const [before, after] = documents;
    if (ctx.signal.aborted) throw new DOMException('Comparison cancelled', 'AbortError');

    ctx.progress(45, 'aligning pages');
    const pairs = alignPages(before.pages, after.pages);

    const pages: PdfPageRow[] = [];
    let added = 0;
    let removed = 0;
    let changed = 0;
    let imageOnly = 0;

    for (let at = 0; at < pairs.length; at += 1) {
      if (ctx.signal.aborted) throw new DOMException('Comparison cancelled', 'AbortError');
      ctx.progress(45 + (at / Math.max(1, pairs.length)) * 50, 'comparing pages');
      const pair = pairs[at]!;

      const characters = {
        before: pair.before?.text.trim().length ?? 0,
        after: pair.after?.text.trim().length ?? 0,
      };
      if (
        (pair.before !== undefined && characters.before === 0) ||
        (pair.after !== undefined && characters.after === 0)
      ) {
        imageOnly += 1;
      }

      if (pair.before === undefined || pair.after === undefined) {
        if (pair.before === undefined) added += 1;
        else removed += 1;
        pages.push({
          before: pair.before?.number,
          after: pair.after?.number,
          state: pair.before === undefined ? 'added' : 'removed',
          rows: [],
          added: 0,
          removed: 0,
          modified: 0,
          characters,
          resized: undefined,
        });
        continue;
      }

      const resized =
        pair.before.width !== pair.after.width || pair.before.height !== pair.after.height
          ? {
              before: [pair.before.width, pair.before.height] as [number, number],
              after: [pair.after.width, pair.after.height] as [number, number],
            }
          : undefined;

      if (normalise(pair.before.text) === normalise(pair.after.text) && resized === undefined) {
        pages.push({
          before: pair.before.number,
          after: pair.after.number,
          state: 'same',
          rows: [],
          added: 0,
          removed: 0,
          modified: 0,
          characters,
          resized: undefined,
        });
        continue;
      }

      // The text engine does the work inside a page: word marks, folding and the
      // v0.2.6 rules all come free, and there is no second line-diff to maintain.
      const page = diffText(pair.before.text, pair.after.text, options);
      changed += 1;
      pages.push({
        before: pair.before.number,
        after: pair.after.number,
        state: 'changed',
        rows: page.data.rows,
        added: page.stats.added,
        removed: page.stats.removed,
        modified: page.stats.modified,
        characters,
        resized,
      });
    }

    const infoChanges: PdfDiffData['infoChanges'] = [];
    if (options.compareMetadata) {
      for (const key of new Set([...Object.keys(before.info), ...Object.keys(after.info)])) {
        const one = before.info[key];
        const other = after.info[key];
        if (one !== other) infoChanges.push({ key, before: one, after: other });
      }
    }

    const notes: string[] = [
      `Compared ${pairs.length} page${pairs.length === 1 ? '' : 's'} by their text, pairing pages on content rather than on number — an inserted page shifts nothing after it.`,
      // The honest half of this feature, stated where a reader is looking at the result.
      'This is a text comparison. Rendering pages to compare them visually needs a rasteriser TwinScope does not carry; export the pages as PNGs and compare those two folders with the visual engine (--engine visual).',
    ];
    if (imageOnly > 0) {
      notes.push(
        `${imageOnly} page${imageOnly === 1 ? ' has' : 's have'} no extractable text — a scan, or a page that is one image. A text comparison has nothing to say about those.`,
      );
    }
    if (before.truncated || after.truncated) {
      notes.push(`Stopped after ${options.maxPages} pages.`);
    }
    if (infoChanges.length > 0) {
      notes.push(
        `${infoChanges.length} metadata field${infoChanges.length === 1 ? '' : 's'} differ.`,
      );
    }

    ctx.progress(100, 'done');

    const totalLines = pages.reduce(
      (sum, page) => sum + page.added + page.removed + page.modified,
      0,
    );

    return {
      engineId: 'pdf',
      summary: {
        added,
        removed,
        modified: changed,
        extra: {
          pages: `${before.pages.length} → ${after.pages.length}`,
          'changed lines': totalLines,
          ...(imageOnly > 0 ? { 'image-only pages': imageOnly } : {}),
          ...(infoChanges.length > 0 ? { metadata: infoChanges.length } : {}),
        },
        radar: radarFrom({
          structure: ratioScore(added + removed, Math.max(1, before.pages.length)),
          content: ratioScore(changed, Math.max(1, before.pages.length)),
          metadata: ratioScore(
            infoChanges.length,
            Math.max(1, Object.keys(before.info).length || 1),
          ),
          // `visual` stays absent: nothing here rendered a page.
          performance: ratioScore(
            Math.abs(after.pages.length - before.pages.length),
            Math.max(1, before.pages.length),
          ),
        }),
      },
      data: {
        pages,
        counts: { before: before.pages.length, after: after.pages.length },
        info: { before: before.info, after: after.info },
        infoChanges,
        imageOnly,
      },
      normalizationNotes: notes,
      timings: { ms: Date.now() - startedAt },
    };
  },
};
