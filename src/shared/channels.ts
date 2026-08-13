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
  /** Raw bytes for a path. Only the image path needs this — see `input.bytes`. */
  readBytes: 'input:bytes',
  /** Read several paths, tolerating ones that no longer exist. */
  resolveInputs: 'input:resolve',
  /**
   * Text from a byte range of a file (v0.2.8).
   *
   * Large-file mode indexes a file it never holds, so an unchanged span reaches the
   * view as a byte range rather than as rows. This is how opening one of those folds
   * fetches its lines — bounded, so a fold cannot ask for a gigabyte.
   */
  readRange: 'input:range',
  /** Read the system clipboard as an input (MD §34). */
  readClipboard: 'clipboard:read',
  /** Copy text out. Goes through main because the renderer denies all
      permission requests, including clipboard-write. */
  writeClipboard: 'clipboard:write',

  /** Comparison history (MD §36). */
  historyList: 'history:list',
  historyRecord: 'history:record',
  historyOpen: 'history:open',
  historyStar: 'history:star',
  historyRemove: 'history:remove',
  historyClear: 'history:clear',

  /** Projects and saved comparisons (v0.2.9, MD §37). */
  projectsList: 'projects:list',
  projectsSave: 'projects:save',
  projectsRemove: 'projects:remove',
  savedList: 'saved:list',
  savedSave: 'saved:save',
  savedRemove: 'saved:remove',
  savedTouch: 'saved:touch',

  /** Report export (MD §38/§39). */
  exportReport: 'export:report',
  revealReport: 'export:reveal',

  /** Global Quick Compare (v0.2.14, MD §35). */
  quickOpen: 'quick:open',
  quickHandoff: 'quick:handoff',
  quickClose: 'quick:close',
  quickState: 'quick:state',
  /** main → renderer: two inputs arriving from the quick panel. */
  quickInputs: 'quick:inputs',
  /**
   * A cheap fingerprint of the clipboard, for the opt-in watcher.
   *
   * Deliberately *not* `clipboard:read`: that spills every copied image to a temp
   * file, and a poll loop reading content the user has not offered is not something
   * a privacy-first app should do. The signature says "something changed"; the read
   * happens only when the user accepts.
   */
  clipboardSignature: 'clipboard:signature',

  /** Git repositories (v0.2.1, MD §19). Both read-only. */
  gitProbe: 'git:probe',
  gitBlob: 'git:blob',

  /** Preferences that outlive the window. */
  settingsRead: 'settings:read',
  settingsWrite: 'settings:write',

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
  /**
   * Unpackaged build or test run. Gates development-only affordances — the demo
   * engine's button is the only one so far. Carried on `ping` rather than as its
   * own bridge key deliberately: the bridge surface is asserted in
   * `verify.spec.ts` and every entry in it is a hole in context isolation.
   */
  isDev: boolean;
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
  /** For `kind: 'git'`: the ref inside the repository at `path` (v0.2.1). */
  ref?: string;
  /** True when the text was withheld because the input is too big to inline. */
  large?: boolean;
  /** How the bytes were decoded — shown in the status bar (MVP-11). */
  encoding?: string;
  /** Line endings found in the file: LF, CRLF, CR or none. */
  eol?: string;
  /** True when the bytes were not valid in their apparent encoding. */
  lossy?: boolean;
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

/** One side of a stored comparison. Contents are never persisted (Rule 2). */
export interface StoredInput {
  kind: string;
  name: string;
  path?: string;
  size: number;
}

export interface HistoryRow {
  id: number;
  title: string;
  engineId: string;
  a: StoredInput;
  b: StoredInput;
  options: Record<string, unknown>;
  summary: Summary;
  starred: boolean;
  /** SQLite `datetime('now')`, i.e. UTC `YYYY-MM-DD HH:MM:SS`. */
  createdAt: string;
  openedAt: string;
}

/**
 * A project: optional folder scope, per-engine presets, ignore globs (v0.2.9).
 *
 * Nothing requires one to exist. Choosing one **seeds** new comparisons — see
 * `stores/settings.ts`'s `defaultsFor`, which layers presets over the global
 * engine defaults. That is v0.2.6's deferred per-project normalisation.
 */
export interface Project {
  id: number;
  name: string;
  /** A folder the project is about, if it is about one. */
  root?: string;
  /** engineId → option defaults, captured from a real comparison. */
  presets: Record<string, Record<string, unknown>>;
  /** Glob patterns this project always ignores (folder scans, JSON paths). */
  ignores: string[];
  createdAt: string;
}

/**
 * A saved comparison — a *definition*, never a stored result (MD §37).
 *
 * Contents are stripped exactly as history strips them, so opening one re-reads
 * both inputs and re-runs: a saved answer to "what changed" would be a wrong
 * answer as soon as either file moved on.
 */
export interface SavedComparison {
  id: number;
  projectId?: number;
  name: string;
  engineId: string;
  a: StoredInput;
  b: StoredInput;
  options: Record<string, unknown>;
  createdAt: string;
  lastRunAt?: string;
}

/** What the renderer hands main to turn into a report file. */
export interface ReportPayload {
  a: { name: string; path?: string; kind: string };
  b: { name: string; path?: string; kind: string };
  engineId: string;
  summary: Summary;
  options: Record<string, unknown>;
  normalizationNotes: string[];
  generatedAt: string;
  data: unknown;
  /** `data:` URLs, embedded so an HTML report needs no companion files. */
  images?: { before?: string; after?: string; mask?: string };
}

/** One commit as the ref picker lists it (v0.2.1). */
export interface GitCommitInfo {
  sha: string;
  shortSha: string;
  subject: string;
  when: string;
}

/** What a repository offers as comparable refs. `null` from `probe` = not a repo. */
export interface GitRepoInfo {
  root: string;
  head: string;
  detached: boolean;
  branches: string[];
  tags: string[];
  recent: GitCommitInfo[];
  dirty: boolean;
}

/** What the quick panel can tell the renderer about itself (v0.2.14). */
export interface QuickState {
  /** True when this window IS the quick panel. */
  isQuick: boolean;
  /** False when another application already owns the global shortcut. */
  shortcutRegistered: boolean;
  shortcut: string;
}

/** A fingerprint of the clipboard, cheap enough to poll (v0.2.14). */
export interface ClipboardSignature {
  /** 'text' | 'image' | 'empty' */
  kind: string;
  /** Length for text, byte size for an image. Zero when empty. */
  size: number;
  /** First and last few characters of text, so a change is detectable. */
  hint: string;
}

export type ThemePreference = 'system' | 'dark' | 'light';

export interface Preferences {
  theme: ThemePreference;
  /**
   * Global Quick Compare (v0.2.14). Both default to **off**: a global shortcut that
   * takes a combination from another app on first launch is hostile, and a clipboard
   * watcher nobody asked for is worse.
   */
  globalShortcut?: boolean;
  clipboardWatcher?: boolean;
  /** Per-engine option defaults, seeded into every new comparison. */
  engineDefaults: Record<string, Record<string, unknown>>;
  checkUpdates: boolean;
  /**
   * The project whose presets seed new comparisons (v0.2.9). A preference rather
   * than a row in the database: which project you are working in is a property of
   * this machine, not of the projects themselves. `null`/absent = no project.
   */
  activeProjectId?: number | null;
}

/** Cheap re-export so callers need not reach into the engines directory. */
export type { InputRef, InputKind, Summary };

/**
 * Everything exposed to the renderer as `window.twinscope`.
 *
 * Each entry is a deliberate hole in context isolation — keep it narrow, keep
 * it typed, and never expose `ipcRenderer` itself.
 */
export interface TwinScopeApi {
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
     * Raw bytes, for the one job that has to run in the renderer: image
     * comparison needs a decoder, and only the window has one (D8).
     */
    bytes(path: string): Promise<Uint8Array>;
    /**
     * Reads several paths at once, returning `null` for any that no longer
     * exist. Reopening a months-old comparison is exactly that case, and it is
     * an expected outcome rather than an error.
     */
    resolve(
      requests: Array<{ side: 'A' | 'B'; path: string }>,
    ): Promise<Array<InputPayload | null>>;
    /**
     * Decoded text from `[start, end)` of a file (v0.2.8). Rejects a span larger
     * than the cap in `main/input.ts` — a lazily loaded fold is a convenience, not
     * a route for pushing arbitrary volume through IPC.
     */
    range(request: { path: string; start: number; end: number }): Promise<string>;
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
    /**
     * A cheap fingerprint, for the opt-in watcher to poll. Reading the clipboard
     * properly writes images to disk, so the watcher must not do it on a timer.
     */
    signature(): Promise<ClipboardSignature>;
  };

  history: {
    list(options?: { limit?: number; starredOnly?: boolean }): Promise<HistoryRow[]>;
    /** Called after a comparison completes; main strips contents before storing. */
    record(entry: {
      a: InputPayload;
      b: InputPayload;
      engineId: string;
      options: Record<string, unknown>;
      summary: Summary;
    }): Promise<HistoryRow>;
    /** Bumps `openedAt` and returns the row, or null if it is gone. */
    open(id: number): Promise<HistoryRow | null>;
    star(id: number, starred: boolean): Promise<void>;
    remove(id: number): Promise<void>;
    clear(): Promise<void>;
  };

  report: {
    /** Opens a save dialog; resolves with null when the user cancels. */
    save(format: 'html' | 'md' | 'patch', input: ReportPayload): Promise<{ path: string | null }>;
    reveal(path: string): Promise<void>;
  };

  /** Projects and saved comparisons (v0.2.9). */
  projects: {
    list(): Promise<Project[]>;
    /** Creates when `id` is absent, updates when it is present. */
    save(patch: {
      id?: number;
      name: string;
      root?: string;
      presets?: Record<string, Record<string, unknown>>;
      ignores?: string[];
    }): Promise<Project>;
    /** Deletes the project; its saved comparisons survive, unattached. */
    remove(id: number): Promise<void>;
  };

  saved: {
    /** Every saved comparison, or only one project's. */
    list(projectId?: number): Promise<SavedComparison[]>;
    save(entry: {
      projectId?: number;
      name: string;
      engineId: string;
      a: InputPayload;
      b: InputPayload;
      options: Record<string, unknown>;
    }): Promise<SavedComparison>;
    remove(id: number): Promise<void>;
    /** Records that it was run, for ordering by relevance. */
    touch(id: number): Promise<SavedComparison | null>;
  };

  git: {
    /**
     * Describes the repository containing `path`. Resolves to `null` when the
     * folder is not in one — that is an answer the panel shows, not an error.
     */
    probe(path: string): Promise<GitRepoInfo | null>;
    /**
     * One file's content at one ref, or `null` when the file does not exist
     * there. `null` is half of every drill-in: an added file has no BEFORE.
     */
    blob(request: { repo: string; ref: string; path: string }): Promise<string | null>;
  };

  quick: {
    /** Opens the always-on-top panel, as the global shortcut does. */
    open(): Promise<void>;
    /** Hands two inputs to the main window and brings it forward. */
    handoff(inputs: { a: InputPayload; b: InputPayload }): Promise<boolean>;
    close(): Promise<void>;
    state(): Promise<QuickState>;
    /** Two inputs arriving from the panel. Returns an unsubscribe function. */
    onInputs(listener: (inputs: { a: InputPayload; b: InputPayload }) => void): () => void;
  };

  settings: {
    read(): Promise<Preferences>;
    write(patch: Partial<Preferences>): Promise<Preferences>;
  };

  compare: {
    start(request: CompareRequest): Promise<CompareStarted>;
    cancel(jobId: string): Promise<void>;
    /** Returns an unsubscribe function. */
    onEvent(listener: (event: CompareEvent) => void): () => void;
  };
}
