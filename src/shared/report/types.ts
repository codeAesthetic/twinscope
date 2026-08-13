import type { Summary } from '../channels';

/**
 * What a report renderer is given (MD §38/§39).
 *
 * Deliberately loose about `data`: each renderer knows the shape its own engine
 * produces, and typing it precisely here would drag every engine's model into
 * the shared layer that the preload and the future CLI both import.
 */
export interface ReportInput {
  a: { name: string; path?: string; kind: string };
  b: { name: string; path?: string; kind: string };
  engineId: string;
  summary: Summary;
  options: Record<string, unknown>;
  normalizationNotes: string[];
  /** ISO timestamp; passed in so a report is reproducible in tests. */
  generatedAt: string;
  /** The engine's own result model. */
  data: ReportData;
  /** For the image report: `data:` URLs, embedded so the file stands alone. */
  images?: { before?: string; after?: string; mask?: string };
}

/** The union of every engine's row shape, as reports need to read them. */
export interface ReportData {
  rows?: ReportRow[];
  pct?: number;
  diffPixels?: number;
  totalPixels?: number;
  regions?: Array<{
    left: number;
    top: number;
    width: number;
    height: number;
    areaPct: number;
  }>;
  dims?: { before: [number, number]; after: [number, number] };
  sameSize?: boolean;
  roots?: { before: string; after: string };
  files?: { before: number; after: number };
  // git
  repo?: string;
  before?: { ref: string; label: string };
  after?: { ref: string; label: string };
  totals?: { added: number; removed: number };
  partial?: boolean;
}

export interface ReportRow {
  // text
  kind?: string;
  text?: string;
  textRight?: string;
  left?: number | { name: string; status: string; size?: number };
  right?: number | { name: string; status: string; size?: number };
  count?: number;
  // json
  depth?: number;
  key?: string;
  path?: string;
  state?: string;
  container?: string;
  a?: string;
  b?: string;
  value?: string;
  note?: string;
  // folder
  isDir?: boolean;
  status?: string;
  // git
  oldPath?: string;
  added?: number;
  removed?: number;
  binary?: boolean;
  score?: number;
}

export const MARK_OPEN = '⟦';
export const MARK_CLOSE = '⟧';

export function total(summary: Summary): number {
  return summary.added + summary.removed + summary.modified;
}

/** A readable timestamp; the report says when it was made, not just what. */
export function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toISOString().replace('T', ' ').slice(0, 19);
}

/** Rows a reader cares about, for engines whose model is a flat row list. */
export function changeRows(rows: readonly ReportRow[]): ReportRow[] {
  return rows.filter((row) => row.kind !== 'ctx' && row.state !== 'same' && row.status !== 'same');
}
