import { contextBridge, ipcRenderer, webUtils } from 'electron';
import {
  IPC,
  type CompareEvent,
  type CompareRequest,
  type CompareStarted,
  type TwinScopeApi,
  type InputPayload,
  type PingResult,
} from '../shared/channels';

/**
 * The only bridge between the renderer and the rest of the app.
 *
 * Runs sandboxed: it may use Electron and nothing heavyweight. Never expose
 * `ipcRenderer` (or anything that can reach it) to the page — every method here
 * is a deliberate, typed hole in context isolation.
 */
const api: TwinScopeApi = {
  platform: process.platform,

  ping: (): Promise<PingResult> => ipcRenderer.invoke(IPC.ping),

  dialog: {
    pickFile: (side): Promise<InputPayload | null> => ipcRenderer.invoke(IPC.pickFile, side),
    pickFolder: (side): Promise<InputPayload | null> => ipcRenderer.invoke(IPC.pickFolder, side),
  },

  input: {
    read: (side, path): Promise<InputPayload> => ipcRenderer.invoke(IPC.readInput, { side, path }),
    bytes: (path: string): Promise<Uint8Array> => ipcRenderer.invoke(IPC.readBytes, path),
    resolve: (requests) => ipcRenderer.invoke(IPC.resolveInputs, requests),
    // Synchronous and local: it only maps a File the user already dropped onto
    // this window to its path. No IPC, no filesystem access.
    pathForFile: (file: File): string => webUtils.getPathForFile(file),
  },

  clipboard: {
    read: (side): Promise<InputPayload | null> => ipcRenderer.invoke(IPC.readClipboard, side),
    write: (text: string): Promise<void> => ipcRenderer.invoke(IPC.writeClipboard, text),
  },

  history: {
    list: (options) => ipcRenderer.invoke(IPC.historyList, options),
    record: (entry) => ipcRenderer.invoke(IPC.historyRecord, entry),
    open: (id: number) => ipcRenderer.invoke(IPC.historyOpen, id),
    star: (id: number, starred: boolean) => ipcRenderer.invoke(IPC.historyStar, id, starred),
    remove: (id: number) => ipcRenderer.invoke(IPC.historyRemove, id),
    clear: () => ipcRenderer.invoke(IPC.historyClear),
  },

  report: {
    save: (format, input) => ipcRenderer.invoke(IPC.exportReport, format, input),
    reveal: (path: string) => ipcRenderer.invoke(IPC.revealReport, path),
  },

  settings: {
    read: () => ipcRenderer.invoke(IPC.settingsRead),
    write: (patch) => ipcRenderer.invoke(IPC.settingsWrite, patch),
  },

  compare: {
    start: (request: CompareRequest): Promise<CompareStarted> =>
      ipcRenderer.invoke(IPC.compareStart, request),
    cancel: (jobId: string): Promise<void> => ipcRenderer.invoke(IPC.compareCancel, jobId),
    onEvent: (listener: (event: CompareEvent) => void): (() => void) => {
      // The raw IpcRendererEvent is dropped deliberately: handing it to the page
      // would leak `sender`, and with it a route back to ipcRenderer.
      const wrapped = (_event: unknown, payload: CompareEvent): void => listener(payload);
      ipcRenderer.on(IPC.compareEvent, wrapped);
      return () => ipcRenderer.removeListener(IPC.compareEvent, wrapped);
    },
  },
};

contextBridge.exposeInMainWorld('twinscope', api);
