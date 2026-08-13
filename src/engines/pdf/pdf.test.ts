import { describe, expect, it, vi } from 'vitest';
import { alignPages, pdfEngine, type PdfDiffData } from './index';
import { detectKind } from '../detect';
import type { EngineCtx, HostFs, InputRef, PdfDocument, PdfHost, PdfPage } from '../types';

/**
 * The engine against a fake reader — which is the point of `PdfHost`: page alignment
 * and the per-page diff are testable without pdfjs, a PDF fixture, or a canvas. The
 * real reader is exercised by `e2e/regression/pdf-diff.spec.ts`, with a real document.
 */

const page = (number: number, text: string, size: [number, number] = [595, 842]): PdfPage => ({
  number,
  text,
  width: size[0],
  height: size[1],
});

function hostOf(before: PdfDocument, after: PdfDocument): { fs: HostFs; pdf: PdfHost } {
  let call = 0;
  return {
    fs: {
      readBytes: () => Promise.resolve(new Uint8Array([1])),
      readText: () => Promise.reject(new Error('not used')),
      listDir: () => Promise.resolve([]),
      stat: () => Promise.resolve({ size: 1, mtimeMs: 0 }),
      hashFile: () => Promise.resolve(''),
    },
    pdf: {
      read: () => Promise.resolve((call++ === 0 ? before : after) as PdfDocument),
    },
  };
}

const document = (pages: PdfPage[], info: Record<string, string> = {}): PdfDocument => ({
  pages,
  info,
  truncated: false,
});

function ref(side: 'A' | 'B'): InputRef {
  return { side, kind: 'pdf', name: `${side}.pdf`, path: `/${side}.pdf`, size: 10 };
}

async function run(before: PdfDocument, after: PdfDocument, options = {}) {
  const host = hostOf(before, after);
  const ctx: EngineCtx = {
    signal: new AbortController().signal,
    progress: vi.fn(),
    fs: host.fs,
    pdf: host.pdf,
  };
  const result = await pdfEngine.compare(
    ref('A'),
    ref('B'),
    { ...pdfEngine.defaultOptions(), ...options },
    ctx,
  );
  return { result, data: result.data as PdfDiffData };
}

describe('alignPages', () => {
  it('pairs identical pages one to one', () => {
    const pairs = alignPages([page(1, 'a'), page(2, 'b')], [page(1, 'a'), page(2, 'b')]);
    expect(pairs.map((pair) => [pair.before?.number, pair.after?.number])).toEqual([
      [1, 1],
      [2, 2],
    ]);
  });

  it('shifts nothing after an inserted page', () => {
    // The whole reason this function exists: pairing on page *number* would report
    // every page of the document as changed.
    const pairs = alignPages(
      [page(1, 'chapter one'), page(2, 'chapter two')],
      [page(1, 'cover'), page(2, 'chapter one'), page(3, 'chapter two')],
    );
    expect(pairs.map((pair) => [pair.before?.number, pair.after?.number])).toEqual([
      [undefined, 1],
      [1, 2],
      [2, 3],
    ]);
  });

  it('pairs an edited page rather than reporting a removal and an addition', () => {
    const pairs = alignPages(
      [page(1, 'Total: 240.00 for services rendered in March')],
      [page(1, 'Total: 260.00 for services rendered in March')],
    );
    expect(pairs).toHaveLength(1);
    expect(pairs[0]?.before?.number).toBe(1);
    expect(pairs[0]?.after?.number).toBe(1);
  });

  it('reports a page removed from the end', () => {
    const pairs = alignPages([page(1, 'a'), page(2, 'appendix')], [page(1, 'a')]);
    expect(pairs[1]).toEqual({ before: page(2, 'appendix'), after: undefined });
  });
});

describe('pdfEngine', () => {
  it('detects a .pdf as a document rather than as a binary', () => {
    expect(detectKind({ name: 'invoice.pdf', kind: 'unknown' })).toBe('pdf');
  });

  it('diffs a changed page with the text engine, marks and all', async () => {
    const { data, result } = await run(
      document([page(1, 'Total: 240.00\nDue: March')]),
      document([page(1, 'Total: 260.00\nDue: March')]),
    );

    expect(result.summary.modified).toBe(1);
    const changed = data.pages[0];
    expect(changed?.state).toBe('changed');
    expect(changed?.modified).toBe(1);
    // The word-level marks are the text engine's, which is why they are here at all.
    expect(changed?.rows.some((row) => row.text.includes('⟦'))).toBe(true);
  });

  it('says a page has no extractable text rather than calling it identical', async () => {
    const { data, result } = await run(
      document([page(1, ''), page(2, 'real text')]),
      document([page(1, ''), page(2, 'real text')]),
    );
    // One *page position* has no text, not two: the count is of pages in the
    // comparison, and a page that is blank on both sides is one page.
    expect(data.imageOnly).toBe(1);
    expect(result.summary.extra?.['image-only pages']).toBe(1);
    expect(result.normalizationNotes.join(' ')).toMatch(/no extractable text/);
  });

  it('reports a resized page even when its text is the same', async () => {
    const { data } = await run(
      document([page(1, 'same words', [595, 842])]),
      document([page(1, 'same words', [842, 595])]),
    );
    expect(data.pages[0]?.state).toBe('changed');
    expect(data.pages[0]?.resized).toEqual({ before: [595, 842], after: [842, 595] });
  });

  it('compares metadata, and lists only what differs', async () => {
    const { data, result } = await run(
      document([page(1, 'x')], { Title: 'One', Producer: 'Same' }),
      document([page(1, 'x')], { Title: 'Two', Producer: 'Same' }),
    );
    expect(data.infoChanges).toEqual([{ key: 'Title', before: 'One', after: 'Two' }]);
    expect(result.summary.extra?.['metadata']).toBe(1);
  });

  it('can be told to leave metadata alone', async () => {
    const { data } = await run(
      document([page(1, 'x')], { Title: 'One' }),
      document([page(1, 'x')], { Title: 'Two' }),
      { compareMetadata: false },
    );
    expect(data.infoChanges).toEqual([]);
  });

  it('leaves the visual axis absent and says the visual half is not here', async () => {
    const { result } = await run(document([page(1, 'a')]), document([page(1, 'b')]));
    expect(result.summary.radar?.['visual']).toBeUndefined();
    expect(result.normalizationNotes.join(' ')).toMatch(/export the pages as PNGs/);
  });

  it('refuses a host with no PDF reader, and offers the binary engine', async () => {
    const host = hostOf(document([]), document([]));
    await expect(
      pdfEngine.compare(ref('A'), ref('B'), pdfEngine.defaultOptions(), {
        signal: new AbortController().signal,
        progress: vi.fn(),
        fs: host.fs,
      }),
    ).rejects.toMatchObject({
      name: 'EngineInputError',
      fallback: { fallbackEngineId: 'binary' },
    });
  });

  it('turns an unreadable document into an answer, not a stack trace', async () => {
    const ctx: EngineCtx = {
      signal: new AbortController().signal,
      progress: vi.fn(),
      fs: hostOf(document([]), document([])).fs,
      pdf: { read: () => Promise.reject(new Error('encrypted')) },
    };
    await expect(
      pdfEngine.compare(ref('A'), ref('B'), pdfEngine.defaultOptions(), ctx),
    ).rejects.toMatchObject({ message: expect.stringContaining('encrypted') });
  });
});
