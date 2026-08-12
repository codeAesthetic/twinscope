import { imageEngine, type ImageDiffData, type ImageDiffOptions } from '../../../engines/image';
import type { CompareEvent, CompareStarted, InputPayload } from '../../../shared/channels';
import type { HostFs, ImageHost, Raster } from '../../../engines/types';

/**
 * The one comparison that runs in the window instead of the engine host.
 *
 * Decoding an image needs a decoder, and the only one available is the
 * browser's (D8). Moving raw RGBA the other way is not an option either: a 4K
 * pair is 130 MB of pixels, and the standing rule is that big data never crosses
 * IPC. So the pixel work happens here, and the job it produces is
 * indistinguishable from a hosted one — same events, same store, same chassis.
 *
 * **Not a Web Worker**, despite D8: the packaged app loads the renderer from
 * `file://`, and Chromium refuses to construct a worker from an opaque origin.
 * Instead the decode is genuinely off-thread (`createImageBitmap`), and the
 * pixel loop yields between phases so the UI keeps painting. See §7.
 */

const RENDERER_ENGINES = new Set(['image']);

export function isRendererEngine(engineId: string): boolean {
  return RENDERER_ENGINES.has(engineId);
}

/** Only `readBytes` is reachable from here; the rest would need main. */
const rendererFs: HostFs = {
  readBytes: (path) => window.devdiff.input.bytes(path),
  readText: () => Promise.reject(new Error('Text is not read in the renderer.')),
  listDir: () => Promise.reject(new Error('Directories are not listed in the renderer.')),
  stat: () => Promise.reject(new Error('Stat is not available in the renderer.')),
  hashFile: () => Promise.reject(new Error('Hashing is not available in the renderer.')),
};

const browserImages: ImageHost = {
  async decode(bytes, maxDimension) {
    const bitmap = await createImageBitmap(new Blob([bytes as BlobPart]));
    const natural: [number, number] = [bitmap.width, bitmap.height];

    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (context === null) throw new Error('This window cannot rasterise images.');

    context.clearRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const pixels = context.getImageData(0, 0, width, height);
    return { width, height, data: pixels.data, natural };
  },

  encodePng(raster: Raster) {
    const canvas = document.createElement('canvas');
    canvas.width = raster.width;
    canvas.height = raster.height;
    const context = canvas.getContext('2d');
    if (context === null) throw new Error('This window cannot rasterise images.');

    // The cast pins the buffer as a plain ArrayBuffer: `ImageData` refuses a
    // SharedArrayBuffer-backed view, which is all the wider type means here.
    const pixels = new ImageData(
      raster.data as Uint8ClampedArray<ArrayBuffer>,
      raster.width,
      raster.height,
    );
    context.putImageData(pixels, 0, 0);
    return Promise.resolve(canvas.toDataURL('image/png'));
  },
};

/** Lets the browser paint between phases of a long pixel pass. */
function yieldNow(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

const running = new Map<string, AbortController>();

/** What the view needs on top of the engine's numbers: the images themselves. */
export interface ImageViewData extends ImageDiffData {
  beforeUrl: string;
  afterUrl: string;
}

export async function startImageJob(
  a: InputPayload,
  b: InputPayload,
  options: Partial<ImageDiffOptions>,
  emit: (event: CompareEvent) => void,
): Promise<CompareStarted> {
  const jobId = crypto.randomUUID();
  const controller = new AbortController();
  running.set(jobId, controller);

  const started: CompareStarted = {
    jobId,
    engineId: imageEngine.meta.id,
    engineLabel: imageEngine.meta.label,
  };

  // Deliberately not awaited: `start` returns as soon as the job is registered,
  // exactly like the IPC path, and the result arrives as an event.
  void (async () => {
    try {
      const result = await imageEngine.compare(
        toRef(a),
        toRef(b),
        { ...imageEngine.defaultOptions(), ...options },
        {
          signal: controller.signal,
          progress: (percent, message) =>
            emit({
              type: 'progress',
              jobId,
              percent: Math.max(0, Math.min(100, Math.round(percent))),
              ...(message !== undefined ? { message } : {}),
            }),
          fs: rendererFs,
          image: browserImages,
          yieldNow,
        },
      );

      const [beforeUrl, afterUrl] = await Promise.all([dataUrl(a), dataUrl(b)]);

      emit({
        type: 'done',
        jobId,
        engineId: result.engineId,
        summary: result.summary,
        data: { ...result.data, beforeUrl, afterUrl } satisfies ImageViewData,
        normalizationNotes: result.normalizationNotes,
        ms: result.timings.ms,
      });
    } catch (cause) {
      const cancelled =
        controller.signal.aborted || (cause instanceof Error && cause.name === 'AbortError');
      emit({
        type: 'error',
        jobId,
        message: cancelled
          ? 'Comparison cancelled.'
          : cause instanceof Error
            ? cause.message
            : String(cause),
        reason: cancelled ? 'cancelled' : 'failed',
      });
    } finally {
      running.delete(jobId);
    }
  })();

  return started;
}

export function cancelImageJob(jobId: string): void {
  running.get(jobId)?.abort();
}

function toRef(payload: InputPayload) {
  return {
    side: payload.side,
    kind: payload.kind,
    name: payload.name,
    size: payload.size,
    ...(payload.path !== undefined ? { path: payload.path } : {}),
  };
}

/**
 * A `data:` URL for the <img> tags.
 *
 * A blob URL would be cheaper, but the HTML report has to be a single file that
 * still shows its images on someone else's machine — and a blob URL is
 * meaningless the moment it leaves this window. Base64 costs a third more
 * memory; the 64 MB read cap keeps that bounded.
 */
async function dataUrl(payload: InputPayload): Promise<string> {
  if (payload.path === undefined) return '';
  const bytes = await window.devdiff.input.bytes(payload.path);

  // btoa in one call blows the argument limit on anything sizeable.
  let binary = '';
  const CHUNK = 0x8000;
  for (let at = 0; at < bytes.length; at += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(at, at + CHUNK));
  }

  return `data:${mimeFor(payload.name)};base64,${btoa(binary)}`;
}

function mimeFor(name: string): string {
  const extension = name.toLowerCase().split('.').pop() ?? '';
  const known: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    gif: 'image/gif',
    avif: 'image/avif',
    bmp: 'image/bmp',
  };
  return known[extension] ?? 'image/png';
}
