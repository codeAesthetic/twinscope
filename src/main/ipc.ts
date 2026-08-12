import { BrowserWindow, dialog, ipcMain } from 'electron';
import { cancelComparison, startComparison } from './engine-host';
import { readClipboard, writeClipboard } from './clipboard';
import { readBytes, readInput } from './input';
import { IPC, type InputPayload, type PingResult } from '../shared/channels';
import { z } from 'zod';
import {
  CompareRequestSchema,
  JobIdSchema,
  ReadBytesSchema,
  ReadInputSchema,
  SideSchema,
} from '../shared/schemas';

/**
 * Every `ipcMain` handler lives here.
 *
 * Two standing rules (plan §3.7):
 *  1. Validate everything the renderer sends — `zod.parse` at the boundary.
 *     A compromised renderer is the threat model context isolation exists for.
 *  2. Return plain serializable data. Never hand a renderer a live object.
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

  ipcMain.handle(IPC.pickFile, async (event, rawSide: unknown): Promise<InputPayload | null> => {
    const side = SideSchema.parse(rawSide);
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return null;

    const result = await dialog.showOpenDialog(window, {
      properties: ['openFile'],
      title: side === 'A' ? 'Choose the BEFORE file' : 'Choose the AFTER file',
    });

    const path = result.filePaths[0];
    if (result.canceled || path === undefined) return null;
    return readInput(side, path);
  });

  ipcMain.handle(IPC.pickFolder, async (event, rawSide: unknown): Promise<InputPayload | null> => {
    const side = SideSchema.parse(rawSide);
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return null;

    const result = await dialog.showOpenDialog(window, {
      properties: ['openDirectory'],
      title: side === 'A' ? 'Choose the BEFORE folder' : 'Choose the AFTER folder',
    });

    const path = result.filePaths[0];
    if (result.canceled || path === undefined) return null;
    return readInput(side, path);
  });

  ipcMain.handle(IPC.readInput, async (_event, payload: unknown): Promise<InputPayload> => {
    const { side, path } = ReadInputSchema.parse(payload);
    return readInput(side, path);
  });

  ipcMain.handle(IPC.readBytes, async (_event, rawPath: unknown): Promise<Uint8Array> => {
    return readBytes(ReadBytesSchema.parse(rawPath));
  });

  ipcMain.handle(IPC.readClipboard, async (_event, rawSide: unknown) => {
    return readClipboard(SideSchema.parse(rawSide));
  });

  ipcMain.handle(IPC.writeClipboard, (_event, rawText: unknown): void => {
    // Bounded: this exists for "copy details" and copied diff lines, not as a
    // channel for a renderer to push arbitrary volume into the system.
    writeClipboard(z.string().max(2_000_000).parse(rawText));
  });

  ipcMain.handle(IPC.compareStart, (event, payload: unknown) => {
    const request = CompareRequestSchema.parse(payload);
    return startComparison(event.sender, request as Parameters<typeof startComparison>[1]);
  });

  ipcMain.handle(IPC.compareCancel, (_event, rawJobId: unknown): void => {
    cancelComparison(JobIdSchema.parse(rawJobId));
  });
}
