import { BrowserWindow, dialog, shell, type WebContents } from 'electron';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { renderHtml } from '../shared/report/html';
import { renderMarkdown, renderUnifiedPatch } from '../shared/report/markdown';
import type { ReportInput } from '../shared/report/types';

/**
 * Writing a report to disk (MD §38/§39).
 *
 * Rendering lives in `shared/report` so the CLI can produce identical files;
 * this module only owns the parts that need Electron — the save dialog, the
 * write, and revealing the result.
 */

export type ReportFormat = 'html' | 'md' | 'patch';

const EXTENSION: Record<ReportFormat, string> = { html: 'html', md: 'md', patch: 'diff' };

function defaultName(format: ReportFormat, generatedAt: string): string {
  const date = generatedAt.slice(0, 10);
  return `twinscope-report-${date}.${EXTENSION[format]}`;
}

export function render(format: ReportFormat, input: ReportInput): string {
  if (format === 'html') return renderHtml(input);
  if (format === 'patch') return renderUnifiedPatch(input);
  return renderMarkdown(input);
}

export interface ExportResult {
  /** Null when the user cancelled the save dialog. */
  path: string | null;
}

export async function exportReport(
  sender: WebContents,
  format: ReportFormat,
  input: ReportInput,
): Promise<ExportResult> {
  const window = BrowserWindow.fromWebContents(sender);
  const suggested = defaultName(format, input.generatedAt);

  const result = await (window === null
    ? dialog.showSaveDialog({ defaultPath: suggested })
    : dialog.showSaveDialog(window, {
        defaultPath: suggested,
        title: 'Save comparison report',
        filters: [
          { name: format === 'html' ? 'HTML report' : 'Text', extensions: [EXTENSION[format]] },
        ],
      }));

  // An empty path is the same answer as a cancel — never write to `''`.
  if (result.canceled || !result.filePath) return { path: null };

  await writeFile(result.filePath, render(format, input), 'utf8');
  return { path: result.filePath };
}

/** Opens the containing folder with the file selected. */
export function revealReport(path: string): void {
  shell.showItemInFolder(path);
}

/** Used by tests: render straight to a known path, with no dialog. */
export async function writeReportTo(
  directory: string,
  format: ReportFormat,
  input: ReportInput,
): Promise<string> {
  const path = join(directory, defaultName(format, input.generatedAt));
  await writeFile(path, render(format, input), 'utf8');
  return path;
}
