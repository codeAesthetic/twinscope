import type { InputKind, InputRef, Summary } from '../engines/types';

/**
 * The contract between processes: channel names, wire shapes, and the bridge.
 *
 * No *runtime* dependency may enter this file — the sandboxed preload imports
 * it, and anything heavier lands in its bundle. Type-only imports are fine,
 * since they erase at build time. Runtime validation lives in `./schemas`,
 * which only main imports.
 */
export const IPC = {
  /** Liveness + version probe. Proves the bridge works end to end. */
  ping: 'app:ping',

  /** Native pickers. */
  pickFile: 'dialog:pickFile',
  pickFolder: 'dialog:pickFolder',

  /** Turn a path into an InputRef: stat, sniff the kind, read small text. */
  readInput: 'input:read',
  /** Read the system clipboard as an input (MD §34). */
  readClipboard: 'clipboard:read',
  /** Copy text out. Goes through main because the renderer denies all
      permission requests, including clipboard-write. */
  writeClipboard: 'clipboard:write',

  /** Comparison job lifecycle. */
  compareStart: 'compare:start',
  compareCancel: 'compare:cancel',
  /** main → renderer. One channel for every job event; switch on `type`. */
  compareEvent: 'compare:event',
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];

export interface PingResult {
  pong: true;
  versions: { electron: string; chrome: string; node: string };
}

/**
 * What crosses the wire for one side of a comparison.
 *
 * Large inputs travel as a path only — the engine host reads the bytes itself,
 * so multi-megabyte payloads never pass through IPC (plan §3.1, MD §31).
 */
export interface InputPayload {
  side: 'A' | 'B';
  kind: InputKind;
  name: string;
  path?: string;
  text?: string;
  size: number;
  lang?: string;
  /** True when the text was withheld because the input is too big to inline. */
  large?: boolean;
}

export interface CompareRequest {
  a: InputPayload;
  b: InputPayload;
  /** Omit to let the registry choose (Rule 1: detect, don't ask). */
  engineId?: string;
  options?: Record<string, unknown>;
}

export interface CompareStarted {
  jobId: string;
  engineId: string;
  engineLabel: string;
}

export interface CompareProgress {
  type: 'progress';
  jobId: string;
  percent: number;
  message?: string;
}

export interface CompareDone {
  type: 'done';
  jobId: string;
  engineId: string;
  summary: Summary;
  data: unknown;
  normalizationNotes: string[];
  ms: number;
}

export interface CompareFailed {
  type: 'error';
  jobId: string;
  /** Safe to show a user. */
  message: string;
  /** 'cancelled' when the user stopped it; 'crash' when the host died. */
  reason: 'failed' | 'cancelled' | 'crash';
  /**
   * Another engine that could still compare these inputs — unparseable JSON is
   * still readable as text. The error panel renders it as a one-click retry.
   */
  fallback?: { engineId: string; label: string };
}

export type CompareEvent = CompareProgress | CompareDone | CompareFailed;

/** Cheap re-export so callers need not reach into the engines directory. */
export type { InputRef, InputKind, Summary };

/**
 * Everything exposed to the renderer as `window.devdiff`.
 *
 * Each entry is a deliberate hole in context isolation — keep it narrow, keep
 * it typed, and never expose `ipcRenderer` itself.
 */
export interface DevDiffApi {
  /**
   * Host platform, read once at preload time. The UI needs it for chrome
   * details — macOS draws traffic lights over the window.
   */
  platform: 'darwin' | 'win32' | 'linux' | string;

  ping(): Promise<PingResult>;

  dialog: {
    /** Resolves to null when the user cancels. */
    pickFile(side: 'A' | 'B'): Promise<InputPayload | null>;
    pickFolder(side: 'A' | 'B'): Promise<InputPayload | null>;
  };

  input: {
    read(side: 'A' | 'B', path: string): Promise<InputPayload>;
    /**
     * Resolves a dropped `File` to its absolute path.
     *
     * `File.path` was removed in Electron 32; `webUtils.getPathForFile` is the
     * replacement, and it must be called in the preload.
     */
    pathForFile(file: File): string;
  };

  clipboard: {
    /** Null when the clipboard holds nothing usable. */
    read(side: 'A' | 'B'): Promise<InputPayload | null>;
    write(text: string): Promise<void>;
  };

  compare: {
    start(request: CompareRequest): Promise<CompareStarted>;
    cancel(jobId: string): Promise<void>;
    /** Returns an unsubscribe function. */
    onEvent(listener: (event: CompareEvent) => void): () => void;
  };
}
