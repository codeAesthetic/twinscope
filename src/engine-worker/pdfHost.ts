import type * as PdfjsLegacy from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PdfDocument, PdfHost, PdfPage } from '../engines/types';

/**
 * Reading PDFs with `pdfjs-dist` (v0.3.3).
 *
 * Lives here rather than in `engines/pdf/` for the reason `ImageHost` exists: the
 * parser is about a megabyte of JavaScript, and `catalog.ts` is imported by the
 * *renderer* — where this engine never runs. Importing pdfjs from the engine would put
 * all of it in the window's bundle to satisfy a type.
 *
 * The **legacy** build, deliberately: the modern one assumes a browser (it reaches for
 * `DOMMatrix` and friends), and this is a plain Node process. Text extraction needs
 * neither a canvas nor a worker, which is exactly the half of pdfjs used here.
 *
 * `cMapUrl` and `standardFontDataUrl` are deliberately **not** set, and
 * `electron-builder.yml` excludes both directories from the package: they exist for
 * rendering, they would mean reading files on behalf of a document from anywhere, and
 * they are 2.4 MB of an installer with a 130 MB budget. The cost is stated rather than
 * hidden — text extraction from a PDF whose CJK text depends on an external CMap will
 * be incomplete, and pdfjs says so in the text it returns.
 */

/** Loaded on first use, so a comparison that is not a PDF never pays for the parser. */
let pdfjs: typeof PdfjsLegacy | undefined;

/**
 * The globals pdfjs expects when it thinks it is in a browser.
 *
 * It decides that here: pdfjs's `isNodeJS` is deliberately **false under Electron** —
 * correct in a renderer, wrong in a `utilityProcess`, which is Electron with no DOM. So
 * its own Node polyfills (which would pull `DOMMatrix` from `@napi-rs/canvas`) never
 * run, and loading a document died on `DOMMatrix is not defined`.
 *
 * These stubs exist to be *referenced*, not used: text extraction never multiplies a
 * matrix, and the reference sits in the rendering path pdfjs wires up eagerly. Adding
 * `@napi-rs/canvas` for a real one would be a native dependency — the exact thing
 * `node:sqlite` was chosen over better-sqlite3 to avoid — for a code path this host
 * does not enter.
 */
function ensureBrowserGlobals(): void {
  const scope = globalThis as Record<string, unknown>;

  scope['DOMMatrix'] ??= class DOMMatrixStub {
    a = 1;
    b = 0;
    c = 0;
    d = 1;
    e = 0;
    f = 0;
    constructor(init?: number[]) {
      if (Array.isArray(init) && init.length >= 6) {
        [this.a, this.b, this.c, this.d, this.e, this.f] = init as [
          number,
          number,
          number,
          number,
          number,
          number,
        ];
      }
    }
    // Rendering is what would call this, and this host never renders. Throwing is
    // better than silently returning an identity transform and drawing nonsense.
    multiply(): never {
      throw new Error('This TwinScope host extracts PDF text and does not render pages.');
    }
  };

  scope['Path2D'] ??= class Path2DStub {};
  scope['navigator'] ??= { language: 'en-US', platform: '', userAgent: 'twinscope' };
}

/**
 * Loads pdfjs with its **Node** path taken.
 *
 * pdfjs decides where it is running from `process.type`: undefined or `'browser'` means
 * Node or Electron's main process, and anything else means a renderer. A
 * `utilityProcess` reports `'utility'`, so pdfjs concluded it was in a browser and
 * demanded a `workerSrc` — a Web Worker this process cannot construct — having already
 * skipped the polyfills it applies under Node.
 *
 * A utilityProcess *is* Node without a DOM, which is exactly what pdfjs's Node path is
 * for. So `process.type` is hidden for the duration of the import and restored
 * immediately: it is Electron's own marker, nothing in this worker reads it, and the
 * alternative was bundling a Web Worker shim to satisfy a check about an environment
 * this is not.
 */
async function library(): Promise<typeof PdfjsLegacy> {
  if (pdfjs !== undefined) return pdfjs;

  ensureBrowserGlobals();
  const marker = Object.getOwnPropertyDescriptor(process, 'type');
  try {
    Object.defineProperty(process, 'type', { value: undefined, configurable: true });
    pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  } finally {
    if (marker !== undefined) Object.defineProperty(process, 'type', marker);
  }
  return pdfjs;
}

function infoOf(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (typeof raw !== 'object' || raw === null) return out;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    // Only the fields that are worth reporting as text: the rest of pdfjs's `info` is
    // booleans about the file format, which say nothing about the document.
    if (typeof value === 'string' && value !== '') out[key] = value;
  }
  return out;
}

/**
 * The one pdfjs message `verbosity: 0` does not cover.
 *
 * pdfjs probes for `@napi-rs/canvas` when it prepares a document and warns if it is
 * absent — and it is absent **on purpose**: nothing here renders a page, and a native
 * canvas is the dependency this project has declined from the start. The probe writes
 * through the console rather than through pdfjs's own logger, so the verbosity option
 * never reaches it.
 *
 * Exactly that line is dropped; everything else pdfjs says still gets through. It only
 * appears on a **clean install** — this repo carries the package transitively, so the
 * warning was invisible here and took an npm tarball to find, printed on every PDF
 * comparison a user of the published CLI would run.
 */
async function withoutCanvasWarning<T>(run: () => Promise<T>): Promise<T> {
  // `warn` and `error` only: the message goes to stderr, and `--json` on stdout is
  // provably unaffected — which matters, because filtering stdout in a host would risk
  // the CLI's machine-readable contract to tidy a cosmetic line.
  const warn = console.warn;
  const error = console.error;
  const isCanvasProbe = (args: unknown[]): boolean =>
    typeof args[0] === 'string' && args[0].includes('@napi-rs/canvas');

  console.warn = (...args: unknown[]): void => {
    if (!isCanvasProbe(args)) warn(...args);
  };
  console.error = (...args: unknown[]): void => {
    if (!isCanvasProbe(args)) error(...args);
  };

  try {
    return await run();
  } finally {
    console.warn = warn;
    console.error = error;
  }
}

async function readDocument(bytes: Uint8Array, maxPages: number): Promise<PdfDocument> {
  {
    const { getDocument } = await library();

    const document = await getDocument({
      // A copy: pdfjs transfers the buffer it is given, and the caller may still hold
      // a reference to it (both sides of a comparison come from the same read path).
      data: new Uint8Array(bytes),
      // No system fonts: extracting text needs none, and loading them would mean
      // reading files on behalf of a document that came from anywhere.
      useSystemFonts: false,
      // pdfjs logs "Warning: …" to the console for every unusual document; the worker's
      // stdout is the app's log, so it stays quiet.
      verbosity: 0,
    }).promise;

    const pages: PdfPage[] = [];
    const count = Math.min(document.numPages, maxPages);

    for (let number = 1; number <= count; number += 1) {
      const page = await document.getPage(number);
      const content = await page.getTextContent();
      const viewport = page.getViewport({ scale: 1 });

      // pdfjs emits one item per text run, with `hasEOL` where the document itself
      // breaks a line. Honouring that is what makes a page's text diff line by line
      // rather than as one paragraph.
      let text = '';
      for (const item of content.items) {
        if (!('str' in item)) continue;
        text += item.str;
        if (item.hasEOL) text += '\n';
        else if (!item.str.endsWith(' ')) text += ' ';
      }

      pages.push({
        number,
        text: text.replace(/[ \t]+\n/g, '\n').trimEnd(),
        width: Math.round(viewport.width),
        height: Math.round(viewport.height),
      });

      page.cleanup();
    }

    const metadata = await document.getMetadata().catch(() => undefined);
    // `cleanup()`, not `destroy()`: the latter is on the *loading task*, not the
    // document, and typing catches that here rather than at runtime.
    await document.cleanup();

    return {
      pages,
      info: infoOf(metadata?.info),
      truncated: document.numPages > count,
    };
  }
}

export const nodePdfHost: PdfHost = {
  read: (bytes: Uint8Array, maxPages: number): Promise<PdfDocument> =>
    withoutCanvasWarning(() => readDocument(bytes, maxPages)),
};
