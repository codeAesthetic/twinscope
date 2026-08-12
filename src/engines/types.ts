/**
 * The comparison engine contract (plan §3.3, MD §23).
 *
 * Everything in src/engines is host-agnostic: no Electron, no DOM, no direct
 * filesystem access. Engines receive what they need through `EngineCtx`, which
 * is what will let the CLI (V1-2) reuse them unchanged. The lint config
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

/** Filesystem access, injected by the host so engines stay portable. */
export interface HostFs {
  readText(path: string): Promise<string>;
  readBytes(path: string): Promise<Uint8Array>;
  listDir(path: string): Promise<Array<{ name: string; path: string; isDirectory: boolean }>>;
  stat(path: string): Promise<{ size: number; mtimeMs: number }>;
}

export interface EngineCtx {
  signal: AbortSignal;
  progress(percent: number, message?: string): void;
  fs?: HostFs;
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

/** Thrown by stub engines until their feature lands. */
export class NotImplementedError extends Error {
  constructor(engineId: string) {
    super(`The ${engineId} engine is not implemented yet`);
    this.name = 'NotImplementedError';
  }
}
