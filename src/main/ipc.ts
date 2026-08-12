import { ipcMain } from 'electron';
import { IPC, type PingResult } from '../shared/channels';

/**
 * Every `ipcMain` handler lives here. Once the renderer starts sending real
 * payloads (MVP-1), validate them at this boundary before use.
 */
export function registerIpcHandlers(): void {
  ipcMain.handle(IPC.ping, (): PingResult => {
    return {
      pong: true,
      versions: {
        electron: process.versions.electron,
        chrome: process.versions.chrome,
        node: process.versions.node,
      },
    };
  });
}
