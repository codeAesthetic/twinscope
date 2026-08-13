/**
 * A minimal, hand-written PDF (v0.3.3).
 *
 * Generated rather than committed, for the same reason the image specs generate their
 * PNGs: a fixture nobody can review is a fixture nobody trusts. This writes the
 * smallest structurally valid document pdfjs will read — a catalog, a page tree, one
 * content stream per page, one font — with no compression, so the bytes in the file are
 * the text in the test.
 *
 * **That readability made the whole suite blind to a released bug.** An uncompressed
 * ASCII PDF contains no NUL byte, and `main/input.ts` demoted anything with a NUL in
 * its first 8 KB to `kind: 'binary'` — which is *every* PDF a real generator writes,
 * because the streams are Flate-compressed and the fonts embedded. The engine was
 * unreachable in the shipped app and every test passed. `{ realistic: true }` below is
 * the answer: the same document, written the way a real one is.
 */
import { deflateSync } from 'node:zlib';

export interface PdfPageSpec {
  /** One string per line, drawn top to bottom. */
  lines: string[];
  /** Points. Defaults to A4-ish. */
  width?: number;
  height?: number;
}

function escapeText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/** `BT … ET` with one `Td` per line, which is what makes pdfjs report a line break. */
function contentFor(page: PdfPageSpec): string {
  const height = page.height ?? 842;
  const lines = page.lines
    .map((line, index) => `1 0 0 1 40 ${height - 60 - index * 20} Tm (${escapeText(line)}) Tj`)
    .join('\n');
  return `BT\n/F1 12 Tf\n14 TL\n${lines}\nET`;
}

export interface PdfOptions {
  /**
   * Write the document the way a real generator does: Flate-compressed content
   * streams and an embedded binary object, which together put NUL bytes in the
   * first kilobytes of the file.
   *
   * Use this for anything that asserts how a PDF is *classified*. The plain form
   * is pure ASCII, and a sniff that mistakes a PDF for an opaque blob cannot fail
   * against it — which is precisely how it reached a release.
   */
  realistic?: boolean;
}

export function makePdf(
  pages: PdfPageSpec[],
  info: Record<string, string> = {},
  options: PdfOptions = {},
): Buffer {
  const objects: string[] = [];
  const realistic = options.realistic === true;
  // 1 = catalog, 2 = page tree, 3 = font, [4 = embedded binary], then 2 per page.
  const firstPage = realistic ? 5 : 4;
  const pageIds = pages.map((_, index) => firstPage + index * 2);

  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push(
    `<< /Type /Pages /Count ${pages.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] >>`,
  );
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');

  if (realistic) {
    // Stands in for the embedded font or ICC profile a real document carries. It is
    // referenced by nothing, which pdfjs does not mind, and it guarantees the NUL
    // bytes that make this fixture representative rather than hoping compression
    // produces one.
    const blob = Buffer.alloc(512);
    for (let at = 0; at < blob.length; at += 1) blob[at] = at % 256;
    objects.push(
      `<< /Type /EmbeddedFile /Length ${blob.length} >>\nstream\n` +
        `${blob.toString('latin1')}\nendstream`,
    );
  }

  pages.forEach((page, index) => {
    const id = pageIds[index] as number;
    const plain = contentFor(page);
    // latin1 throughout: the xref offsets below are byte offsets, and a compressed
    // stream is bytes. Encoding it as UTF-8 would shift every one of them.
    const content = realistic
      ? deflateSync(Buffer.from(plain, 'latin1')).toString('latin1')
      : plain;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${page.width ?? 595} ${page.height ?? 842}] ` +
        `/Resources << /Font << /F1 3 0 R >> >> /Contents ${id + 1} 0 R >>`,
    );
    objects.push(
      `<< /Length ${content.length}${realistic ? ' /Filter /FlateDecode' : ''} >>\n` +
        `stream\n${content}\nendstream`,
    );
  });

  const infoId = objects.length + 1;
  const infoEntries = Object.entries(info)
    .map(([key, value]) => `/${key} (${escapeText(value)})`)
    .join(' ');
  if (infoEntries !== '') objects.push(`<< ${infoEntries} >>`);

  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  const startxref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    body += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  body +=
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R` +
    `${infoEntries === '' ? '' : ` /Info ${infoId} 0 R`} >>\n` +
    `startxref\n${startxref}\n%%EOF\n`;

  // latin1: every byte written above is a byte, not a code point — a UTF-8 encode
  // would shift every offset in the xref table it just wrote.
  return Buffer.from(body, 'latin1');
}
