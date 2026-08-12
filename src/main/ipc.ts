import { BrowserWindow, dialog, ipcMain } from 'electron';
import { cancelComparison, startComparison } from './engine-host';
import { readClipboard, writeClipboard } from './clipboard';
import { readBytes, readInput } from './input';
import { clear, get, list, record, remove, setStarred, touch } from './history';
import { readPreferences, savePreferences } from './settings';
import { IPC, type InputPayload, type PingResult } from '../shared/channels';
import { z } from 'zod';
import {
  CompareRequestSchema,
  HistoryIdSchema,
  HistoryListSchema,
  HistoryRecordSchema,
  JobIdSchema,
  PreferencesPatchSchema,
  ReadBytesSchema,
  ReadInputSchema,
  ResolveInputsSchema,
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

  ipcMain.handle(
    IPC.resolveInputs,
    async (_event, payload: unknown): Promise<Array<InputPayload | null>> => {
      const requests = ResolveInputsSchema.parse(payload);
      // A missing file is the answer, not a failure: reopening a stored
      // comparison months later finds one side gone all the time.
      return Promise.all(requests.map(({ side, path }) => readInput(side, path).catch(() => null)));
    },
  );

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

  // --- history (MD §36). `record` strips file contents inside history.ts, so a
  // compromised renderer cannot persuade the app to persist them.
  ipcMain.handle(IPC.historyList, (_event, payload: unknown) => {
    return list(HistoryListSchema.parse(payload) ?? {});
  });

  ipcMain.handle(IPC.historyRecord, (_event, payload: unknown) => {
    return record(HistoryRecordSchema.parse(payload) as Parameters<typeof record>[0]);
  });

  ipcMain.handle(IPC.historyOpen, (_event, rawId: unknown) => {
    const id = HistoryIdSchema.parse(rawId);
    const row = get(id);
    if (row !== null) touch(id);
    return row;
  });

  ipcMain.handle(IPC.historyStar, (_event, rawId: unknown, rawStarred: unknown): void => {
    setStarred(HistoryIdSchema.parse(rawId), z.boolean().parse(rawStarred));
  });

  ipcMain.handle(IPC.historyRemove, (_event, rawId: unknown): void => {
    remove(HistoryIdSchema.parse(rawId));
  });

  ipcMain.handle(IPC.historyClear, (): void => clear());

  // --- preferences
  ipcMain.handle(IPC.settingsRead, () => readPreferences());

  ipcMain.handle(IPC.settingsWrite, (_event, payload: unknown) => {
    return savePreferences(PreferencesPatchSchema.parse(payload));
  });
}
