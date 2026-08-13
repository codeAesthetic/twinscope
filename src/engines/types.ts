import type { RadarScores } from './radar';

/**
 * The comparison engine contract (plan §3.3, MD §23).
 *
 * Everything in src/engines is host-agnostic: no Electron, no DOM, no direct
 * filesystem access. Engines receive what they need through `EngineCtx`, which
 * is what will let the CLI (v0.2.2) reuse them unchanged. The lint config
 * enforces the Electron half of that.
 */

export type InputKind =
  | 'text'
  | 'code'
  | 'json'
  | 'yaml'
  | 'csv'
  | 'xml'
  | 'deps'
  | 'api'
  | 'env'
  | 'html'
  | 'pdf'
  | 'md'
  | 'image'
  | 'folder'
  | 'binary'
  | 'git'
  | 'unknown';

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
  /**
   * For `kind: 'git'`: which ref this side is. `path` is the repository root and
   * this is the revision inside it, so one repo at two refs is two inputs
   * (v0.2.1). The sentinel `WORKTREE` means the files as they are on disk.
   */
  ref?: string;
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
  /**
   * `length` bytes from `start`. **Optional** (v0.2.8): large-file mode is the only
   * thing that needs it, and making it optional means the hosts that cannot offer
   * it — or the fakes in a test — do not all have to change, while an engine can
   * still *check* and refuse with a fallback instead of reading a gigabyte whole.
   *
   * May return fewer bytes than asked for at end of file, as a read syscall does.
   */
  readRange?(path: string, start: number, length: number): Promise<Uint8Array>;
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

/**
 * Read-only access to a git repository, injected for the same reason `HostFs` is:
 * an engine must not spawn a process any more than it opens a file. The host owns
 * the subcommand allowlist and the process hygiene; the engine builds the argv and
 * parses the output, which is the part worth unit-testing (v0.2.1).
 */
export interface GitHost {
  /** Runs one git command inside `repo` and resolves with its stdout. */
  run(repo: string, args: readonly string[]): Promise<string>;
}

/** One page of a PDF, as far as this app is concerned (v0.3.3). */
export interface PdfPage {
  /** 1-based. */
  number: number;
  /** Extracted text, in reading order as the document declares it. */
  text: string;
  /** Points, at scale 1. */
  width: number;
  height: number;
}

export interface PdfDocument {
  pages: PdfPage[];
  /** Whatever the document says about itself: Title, Author, Producer… */
  info: Record<string, string>;
  /** True when the reader stopped at `maxPages`. */
  truncated: boolean;
}

/**
 * Reading a PDF, injected for the same reason `ImageHost` is (v0.3.3): the parser is
 * a megabyte of JavaScript, and the engine must not drag it into the renderer's
 * bundle — where this engine never runs — just to be importable from `catalog.ts`.
 * The host reads; the engine compares, which is the testable half.
 */
export interface PdfHost {
  read(bytes: Uint8Array, maxPages: number): Promise<PdfDocument>;
}

export interface EngineCtx {
  signal: AbortSignal;
  progress(percent: number, message?: string): void;
  fs?: HostFs;
  image?: ImageHost;
  git?: GitHost;
  pdf?: PdfHost;
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
  /**
   * Diff Radar scores, 0–100 per axis (v0.2.7, MD §21).
   *
   * Its own field rather than `extra`, which the strip renders verbatim as chips —
   * six scores in there would be six chips. An **absent** axis means this engine
   * cannot measure it, which is not the same as scoring it zero.
   */
  radar?: RadarScores;
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

export type { RadarAxis, RadarScores } from './radar';

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
