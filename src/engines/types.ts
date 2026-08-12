/**
 * The comparison engine contract (plan §3.3, MD §23).
 *
 * Everything in src/engines is host-agnostic: no Electron, no DOM, no direct
 * filesystem access. Engines receive what they need through `EngineCtx`, which
 * is what will let the CLI (v0.2.0-2) reuse them unchanged. The lint config
 * enforces the Electron half of that.
 */

export type InputKind =
  'text' | 'code' | 'json' | 'yaml' | 'csv' | 'md' | 'image' | 'folder' | 'binary' | 'unknown';

export interface InputRef {
  side: 'A' | 'B';
  kind: InputKind;
  /** Display name — usually the basename. */
  name: string;
  /** Present when the input came from disk. */
  path?: string;
  /** Present for small text inputs and clipboard content. */
  text?: string;
  size: number;
  /** Detected language id for code inputs (ts, py, sql…). */
  lang?: string;
}

export interface DirEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  /** Symlinks are never followed — a cycle would hang the walk (MD §15). */
  isSymlink: boolean;
}

/** Filesystem access, injected by the host so engines stay portable. */
export interface HostFs {
  readText(path: string): Promise<string>;
  readBytes(path: string): Promise<Uint8Array>;
  listDir(path: string): Promise<DirEntry[]>;
  stat(path: string): Promise<{ size: number; mtimeMs: number }>;
  /** Streamed content hash; the host owns the crypto so engines stay pure. */
  hashFile(path: string): Promise<string>;
}

/** Decoded pixels, in the only layout every image API agrees on. */
export interface Raster {
  width: number;
  height: number;
  /** RGBA, 4 bytes per pixel, row-major. */
  data: Uint8ClampedArray;
}

/**
 * Image decoding and encoding, injected because there is no portable decoder:
 * the renderer has `createImageBitmap`, and the future CLI will have pngjs.
 * The pixel maths in `engines/image` works the same either way.
 */
export interface ImageHost {
  /** Decodes and downscales so the longest side is at most `maxDimension`. */
  decode(bytes: Uint8Array, maxDimension: number): Promise<Raster & { natural: [number, number] }>;
  /** Returns a `data:` URL, which is what a view can render directly. */
  encodePng(raster: Raster): Promise<string>;
}

export interface EngineCtx {
  signal: AbortSignal;
  progress(percent: number, message?: string): void;
  fs?: HostFs;
  image?: ImageHost;
  /**
   * Hands control back to the host mid-computation. On a single-threaded host
   * this is what keeps a long pixel loop from freezing the UI; elsewhere it can
   * be a no-op.
   */
  yieldNow?: () => Promise<void>;
}

export interface Summary {
  added: number;
  removed: number;
  modified: number;
  /** Engine-specific extras shown as chips (identical files, diff %, …). */
  extra?: Record<string, number | string>;
  /** How many differences normalization suppressed (MD §22, Rule 3). */
  suppressed?: number;
}

export interface DiffResult<TData = unknown> {
  engineId: string;
  summary: Summary;
  /** Engine-specific row/tree/region model consumed by that engine's view. */
  data: TData;
  /** Human-readable list of every normalization applied. Rule 3: explainable. */
  normalizationNotes: string[];
  timings: { ms: number };
}

export interface EngineMeta {
  id: string;
  label: string;
  /** Higher wins when several engines can handle the same pair. */
  priority: number;
}

export interface DiffEngine<TOptions = unknown, TData = unknown> {
  meta: EngineMeta;
  canHandle(a: InputRef, b: InputRef): boolean;
  defaultOptions(): TOptions;
  compare(a: InputRef, b: InputRef, options: TOptions, ctx: EngineCtx): Promise<DiffResult<TData>>;
}

/** An offer the error panel can turn into a button. */
export interface EngineFallback {
  fallbackEngineId: string;
  fallbackLabel: string;
}

/**
 * The input is wrong for this engine, but another engine could still say
 * something useful — unparseable JSON is still comparable as text. Carrying the
 * offer on the error keeps the recovery path next to the failure that caused it.
 */
export class EngineInputError extends Error {
  readonly fallback: EngineFallback | undefined;

  constructor(message: string, fallback?: EngineFallback) {
    super(message);
    this.name = 'EngineInputError';
    this.fallback = fallback;
  }
}
