import { DEFAULT_CSV_OPTIONS, diffCsv, type CsvDiffData, type CsvDiffOptions } from './csvDiff';
import { radarFrom, ratioScore } from '../radar';
import type { DiffEngine, DiffResult, InputRef } from '../types';

export type {
  CsvCell,
  CsvCellState,
  CsvColumn,
  CsvColumnStatus,
  CsvDiffData,
  CsvDiffOptions,
  CsvRow,
  CsvRowStatus,
} from './csvDiff';
export { DEFAULT_CSV_OPTIONS, diffCsv } from './csvDiff';
export { parseCsv, sniffDelimiter, delimiterName, MAX_ROWS, MAX_COLUMNS } from './parseCsv';

async function textFor(input: InputRef, read: (path: string) => Promise<string>): Promise<string> {
  if (input.text !== undefined) return input.text;
  if (input.path !== undefined) return read(input.path);
  throw new Error(`${input.name} has no readable content.`);
}

/**
 * Tabular comparison (v0.2.5, A3).
 *
 * Not a structural engine and not a text one: a CSV is a table, and the question
 * a reader has is "which cell changed", which neither a tree nor a line diff can
 * answer. Hence its own row model and its own view.
 */
export const csvEngine: DiffEngine<CsvDiffOptions, CsvDiffData> = {
  meta: { id: 'csv', label: 'Table diff', priority: 26 },

  canHandle: (a, b) => a.kind === 'csv' && b.kind === 'csv',

  defaultOptions: () => ({ ...DEFAULT_CSV_OPTIONS, ignoreColumns: [] }),

  async compare(a, b, options, ctx): Promise<DiffResult<CsvDiffData>> {
    const startedAt = Date.now();
    const read = async (path: string): Promise<string> => {
      if (ctx.fs === undefined) throw new Error('No filesystem access was provided.');
      return ctx.fs.readText(path);
    };

    ctx.progress(10, 'reading');
    const [rawA, rawB] = await Promise.all([textFor(a, read), textFor(b, read)]);

    if (ctx.signal.aborted) throw new DOMException('Comparison cancelled', 'AbortError');

    // A `.tsv` is tab-delimited by definition, so the extension settles it rather
    // than leaving the sniffer to guess from content that may contain either.
    const tabbed = /\.tsv$/i.test(a.name) || /\.tsv$/i.test(b.name);
    const effective: CsvDiffOptions =
      options.delimiter === '' && tabbed ? { ...options, delimiter: '\t' } : options;

    ctx.progress(40, 'comparing rows');
    const { data, stats, notes } = diffCsv(rawA, rawB, effective, () => ctx.signal.aborted);

    ctx.progress(100, 'done');

    const extra: Record<string, number | string> = {
      rows: `${data.counts.before} → ${data.counts.after}`,
      identical: stats.identical,
    };
    if (stats.changedCells > 0) extra.cells = stats.changedCells;
    if (stats.addedColumns > 0) extra['+ columns'] = stats.addedColumns;
    if (stats.removedColumns > 0) extra['− columns'] = stats.removedColumns;
    if (data.partial) extra.scan = 'partial';

    return {
      engineId: 'csv',
      summary: {
        added: stats.added,
        removed: stats.removed,
        modified: stats.modified,
        extra,
        suppressed: stats.suppressed,
        // Radar (v0.2.7). Rows appearing or vanishing is Structure; changed *cells*
        // are Content, scored against the cell count rather than the row count so a
        // one-cell edit in a wide table does not read as a whole changed row. A
        // column added or dropped is a fact about the table's shape → Metadata.
        radar: radarFrom({
          structure: ratioScore(
            stats.added + stats.removed,
            Math.max(data.counts.before, data.counts.after),
          ),
          content: ratioScore(
            stats.changedCells,
            Math.max(data.counts.before, data.counts.after) * Math.max(1, data.columns.length),
          ),
          metadata: ratioScore(
            stats.addedColumns + stats.removedColumns,
            Math.max(1, data.columns.length),
          ),
        }),
      },
      data,
      normalizationNotes: notes,
      timings: { ms: Date.now() - startedAt },
    };
  },
};
