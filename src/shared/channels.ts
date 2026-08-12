/**
 * The contract between processes: channel names and the shape of the bridge.
 *
 * Plain types, no runtime dependency — the sandboxed preload imports this, and
 * anything heavier would end up in its bundle. Runtime validation (zod) arrives
 * with the first real renderer→main payload in MVP-1.
 */
export const IPC = {
  /** Liveness + version probe. Proves the bridge works end to end. */
  ping: 'app:ping',
} as const;

export interface PingResult {
  pong: true;
  versions: { electron: string; chrome: string; node: string };
}

/**
 * Everything exposed to the renderer as `window.devdiff`.
 *
 * Each entry is a deliberate hole in context isolation — keep it narrow, keep
 * it typed, and never expose `ipcRenderer` itself.
 */
export interface DevDiffApi {
  ping(): Promise<PingResult>;
}
