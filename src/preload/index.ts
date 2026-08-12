import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type DevDiffApi } from '../shared/channels';

/**
 * The only bridge between the renderer and the rest of the app.
 *
 * Runs sandboxed: it may use Electron and nothing heavyweight. Never expose
 * `ipcRenderer` (or anything that can reach it) to the page.
 */
const api: DevDiffApi = {
  platform: process.platform,
  ping: () => ipcRenderer.invoke(IPC.ping),
};

contextBridge.exposeInMainWorld('devdiff', api);
