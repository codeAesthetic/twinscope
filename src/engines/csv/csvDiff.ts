import { diffArrays } from 'diff';
import { delimiterName, MAX_ROWS, parseCsv } from './parseCsv';
import { createNormalizer, DEFAULT_NORMALIZE_OPTIONS } from '../normalize';
import type { NormalizeOptions, Normalizer } from '../normalize';

/**
 * Tabular comparison (v0.2.5, A3).
 *
 * Two matching modes, and choosing between them is the whole design:
 *
 *  - **By key column.** Two exports of the same table are the common case, and row
 *    *order* in them is an artefact of whatever the database felt like. Pairing on
 *    a key makes order irrelevant, which is the only correct answer there.
 *  - **By position, aligned.** Without a key, rows are aligned with `diffArrays`
 *    and the removed/added blocks are then paired by similarity — the same
 *    treatment `textDiff` gives lines. A naive index-by-index comparison would
 *    report every row after an insertion as modified.
 */

export type CsvCellState = 'same' | 'chg' | 'add' | 'del' | 'ign';
export type CsvRowStatus = 'same' | 'add' | 'del' | 'mod';
export type CsvColumnStatus = 'same' | 'add' | 'del';

export interface CsvColumn {
  name: string;
  status: CsvColumnStatus;
  /** Excluded from comparison by `ignoreColumns`. */
  ignored: boolean;
  /** True when this is the column rows are paired on. */
  isKey: boolean;
}

export interface CsvCell {
  /** The AFTER value, or the BEFORE value for a deleted row. */
  value: string;
  /** The BEFORE value, present only when it differs. */
  was?: string;
  state: CsvCellState;
}

export interface CsvRow {
  /** Key value when pairing by key, otherwise the display position. */
  key: string;
  status: CsvRowStatus;
  /** 1-based source record numbers, for "row 412 of the export". */
  before?: number;
  after?: number;
  cells: CsvCell[];
  /** How many cells in this row actually changed. */
  changedCells: number;
}

export interface CsvDiffOptions {
  hasHeader: boolean;
  /** Column name to pair rows on. Empty means pair by position. */
  keyColumn: string;
  ignoreColumns: string[];
  trimCells: boolean;
  ignoreCase: boolean;
  /** Empty means sniff it. */
  delimiter: string;
  /**
   * The shared normalisation rules (v0.2.6). Optional: absent means the defaults,
   * which are all off.
   */
  normalize?: NormalizeOptions;
}

export const DEFAULT_CSV_OPTIONS: CsvDiffOptions = {
  hasHeader: true,
  keyColumn: '',
  ignoreColumns: [],
  trimCells: true,
  ignoreCase: false,
  delimiter: '',
};

export interface CsvDiffData {
  columns: CsvColumn[];
  rows: CsvRow[];
  delimiter: string;
  keyColumn: string | null;
  counts: { before: number; after: number };
  partial: boolean;
}

export interface CsvDiffStats {
  added: number;
  removed: number;
  modified: number;
  identical: number;
  changedCells: number;
  addedColumns: number;
  removedColumns: number;
  suppressed: number;
}

/**
 * Field separator for a row signature.
 *
 * A printable delimiter would make `['a,b']` and `['a', 'b']` the same signature,
 * so two different rows could align as one.
 */
const UNIT = '\u001f';

/** Below this a removal and an addition are two rows, not one edit. */
const PAIR_THRESHOLD = 0.5;

/**
 * Similarity is only meaningful with enough columns to judge by.
 *
 * A one-column table can never clear any threshold — a changed cell means zero
 * cells match — so a narrow table would report every edit as a deletion plus an
 * addition. And in a table that reading is usually wrong anyway: a row at the same
 * position inside an aligned block is normally the same *record*, edited. Text
 * lines are the opposite case, which is why `textDiff` needs no such exception.
 */
const MIN_COLUMNS_TO_JUDGE = 3;

function normalise(value: string, options: CsvDiffOptions): string {
  const trimmed = options.trimCells ? value.trim() : value;
  return options.ignoreCase ? trimmed.toLowerCase() : trimmed;
}

/** Header names, or `Column 1…n` when the file has no header row. */
function headerFor(records: readonly string[][], options: CsvDiffOptions): string[] {
  if (options.hasHeader)
    return (records[0] ?? []).map((name, index) => name.trim() || `Column ${index + 1}`);
  const width = records.reduce((widest, row) => Math.max(widest, row.length), 0);
  return Array.from({ length: width }, (_, index) => `Column ${index + 1}`);
}

function bodyOf(records: readonly string[][], options: CsvDiffOptions): string[][] {
  return options.hasHeader ? records.slice(1) : [...records];
}

/**
 * The union of both headers: BEFORE order first, then columns only AFTER has.
 * Keeping the original order matters — a table read in a different column order
 * is unreadable, even if every value is present.
 */
function unionColumns(
  before: readonly string[],
  after: readonly string[],
  options: CsvDiffOptions,
): CsvColumn[] {
  const ignored = new Set(options.ignoreColumns.map((name) => name.trim().toLowerCase()));
  const afterSet = new Set(after);
  const beforeSet = new Set(before);
  const seen = new Set<string>();
  const columns: CsvColumn[] = [];

  const push = (name: string): void => {
    if (seen.has(name)) return;
    seen.add(name);
    columns.push({
      name,
      status: !beforeSet.has(name) ? 'add' : !afterSet.has(name) ? 'del' : 'same',
      ignored: ignored.has(name.toLowerCase()),
      isKey: options.keyColumn !== '' && name.toLowerCase() === options.keyColumn.toLowerCase(),
    });
  };

  for (const name of before) push(name);
  for (const name of after) push(name);
  return columns;
}

/** A row as a lookup by column name, so a reordered header still lines up. */
function asRecord(row: readonly string[], header: readonly string[]): Map<string, string> {
  const map = new Map<string, string>();
  header.forEach((name, index) => map.set(name, row[index] ?? ''));
  return map;
}

function signatureOf(
  row: readonly string[],
  header: readonly string[],
  columns: readonly CsvColumn[],
  options: CsvDiffOptions,
  normalizer?: Normalizer,
): string {
  const record = asRecord(row, header);
  return columns
    .filter((column) => !column.ignored)
    .map((column) => {
      const value = normalise(record.get(column.name) ?? '', options);
      // Masked for alignment as well as for comparison: otherwise two rows that
      // differ only in a regenerated id fail to align, and the whole file below
      // them reads as changed.
      return normalizer === undefined || normalizer.inert ? value : normalizer.mask(value);
    })
    .join(UNIT);
}

/** How alike two rows are, by comparing cell values one for one. */
function similarity(
  left: Map<string, string>,
  right: Map<string, string>,
  columns: readonly CsvColumn[],
  options: CsvDiffOptions,
): number {
  const compared = columns.filter((column) => !column.ignored);
  if (compared.length === 0) return 1;
  const same = compared.filter(
    (column) =>
      normalise(left.get(column.name) ?? '', options) ===
      normalise(right.get(column.name) ?? '', options),
  ).length;
  return same / compared.length;
}

interface Pairing {
  before?: { row: string[]; index: number };
  after?: { row: string[]; index: number };
}

/**
 * Pairs rows by the value of one column.
 *
 * Order becomes irrelevant, which is the point. A duplicate key is disambiguated
 * by occurrence — two rows with the same id pair first-with-first — because
 * refusing to compare the file would be less useful than comparing it carefully.
 */
function pairByKey(
  before: readonly string[][],
  after: readonly string[][],
  headerBefore: readonly string[],
  headerAfter: readonly string[],
  keyColumn: string,
  options: CsvDiffOptions,
): { pairs: Pairing[]; duplicates: number } {
  const keyOf = (row: readonly string[], header: readonly string[]): string =>
    normalise(asRecord(row, header).get(keyColumn) ?? '', options);

  const afterByKey = new Map<string, Array<{ row: string[]; index: number }>>();
  after.forEach((row, index) => {
    const key = keyOf(row, headerAfter);
    const bucket = afterByKey.get(key);
    if (bucket === undefined) afterByKey.set(key, [{ row, index }]);
    else bucket.push({ row, index });
  });

  let duplicates = 0;
  for (const bucket of afterByKey.values()) if (bucket.length > 1) duplicates += bucket.length - 1;

  const pairs: Pairing[] = [];

  before.forEach((row, index) => {
    const key = keyOf(row, headerBefore);
    const bucket = afterByKey.get(key);
    const match = bucket?.shift();
    if (match === undefined) {
      pairs.push({ before: { row, index } });
      return;
    }
    pairs.push({ before: { row, index }, after: match });
  });

  // Whatever is left in the buckets never had a BEFORE row.
  for (const bucket of afterByKey.values()) {
    for (const leftover of bucket) pairs.push({ after: leftover });
  }

  return { pairs, duplicates };
}

/**
 * Pairs rows by position, aligned first.
 *
 * `diffArrays` reports runs of removals and additions; a removal block followed by
 * an addition block is usually the *same* rows edited, so they are zipped and each
 * zipped pair kept as one modification when it is similar enough. Without this an
 * inserted row at the top reports every row below it as changed.
 */
function pairByPosition(
  before: readonly string[][],
  after: readonly string[][],
  headerBefore: readonly string[],
  headerAfter: readonly string[],
  columns: readonly CsvColumn[],
  options: CsvDiffOptions,
  normalizer: Normalizer,
): Pairing[] {
  const beforeSignatures = before.map((row) =>
    signatureOf(row, headerBefore, columns, options, normalizer),
  );
  const afterSignatures = after.map((row) =>
    signatureOf(row, headerAfter, columns, options, normalizer),
  );

  const parts = diffArrays(beforeSignatures, afterSignatures);
  const pairs: Pairing[] = [];
  let beforeAt = 0;
  let afterAt = 0;
  let pendingRemovals: Array<{ row: string[]; index: number }> = [];

  const flushRemovals = (): void => {
    for (const removal of pendingRemovals) pairs.push({ before: removal });
    pendingRemovals = [];
  };

  for (const part of parts) {
    const count = part.value.length;

    if (part.removed === true) {
      flushRemovals();
      pendingRemovals = Array.from({ length: count }, (_, offset) => ({
        row: before[beforeAt + offset] as string[],
        index: beforeAt + offset,
      }));
      beforeAt += count;
      continue;
    }

    if (part.added === true) {
      const additions = Array.from({ length: count }, (_, offset) => ({
        row: after[afterAt + offset] as string[],
        index: afterAt + offset,
      }));
      afterAt += count;

      // Zip as far as both blocks go, keeping a pair only when the rows resemble
      // each other; otherwise they are a genuine removal and a genuine addition.
      const zipped = Math.min(pendingRemovals.length, additions.length);
      for (let at = 0; at < zipped; at += 1) {
        const removal = pendingRemovals[at] as { row: string[]; index: number };
        const addition = additions[at] as { row: string[]; index: number };
        const comparable = columns.filter((column) => !column.ignored).length;
        const alike = similarity(
          asRecord(removal.row, headerBefore),
          asRecord(addition.row, headerAfter),
          columns,
          options,
        );
        const isEdit = comparable < MIN_COLUMNS_TO_JUDGE || alike >= PAIR_THRESHOLD;
        if (isEdit) pairs.push({ before: removal, after: addition });
        else pairs.push({ before: removal }, { after: addition });
      }
      for (const removal of pendingRemovals.slice(zipped)) pairs.push({ before: removal });
      for (const addition of additions.slice(zipped)) pairs.push({ after: addition });
      pendingRemovals = [];
      continue;
    }

    flushRemovals();
    for (let offset = 0; offset < count; offset += 1) {
      pairs.push({
        before: { row: before[beforeAt + offset] as string[], index: beforeAt + offset },
        after: { row: after[afterAt + offset] as string[], index: afterAt + offset },
      });
    }
    beforeAt += count;
    afterAt += count;
  }

  flushRemovals();
  return pairs;
}

export function diffCsv(
  beforeText: string,
  afterText: string,
  options: CsvDiffOptions,
  shouldAbort?: () => boolean,
): { data: CsvDiffData; stats: CsvDiffStats; notes: string[] } {
  const normalizer = createNormalizer(options.normalize ?? DEFAULT_NORMALIZE_OPTIONS);
  const beforeTable = parseCsv(beforeText, options.delimiter);
  const afterTable = parseCsv(afterText, options.delimiter || beforeTable.delimiter);

  const headerBefore = headerFor(beforeTable.records, options);
  const headerAfter = headerFor(afterTable.records, options);
  const columns = unionColumns(headerBefore, headerAfter, options);

  const beforeRows = bodyOf(beforeTable.records, options);
  const afterRows = bodyOf(afterTable.records, options);

  const keyColumn =
    options.keyColumn !== '' && columns.some((column) => column.isKey) ? options.keyColumn : null;

  const keyed =
    keyColumn === null
      ? null
      : pairByKey(beforeRows, afterRows, headerBefore, headerAfter, keyColumn, options);
  const pairs =
    keyed?.pairs ??
    pairByPosition(beforeRows, afterRows, headerBefore, headerAfter, columns, options, normalizer);

  const stats: CsvDiffStats = {
    added: 0,
    removed: 0,
    modified: 0,
    identical: 0,
    changedCells: 0,
    addedColumns: columns.filter((column) => column.status === 'add').length,
    removedColumns: columns.filter((column) => column.status === 'del').length,
    suppressed: 0,
  };

  const rows: CsvRow[] = [];

  for (const [position, pair] of pairs.entries()) {
    if (shouldAbort?.() === true) throw new DOMException('Comparison cancelled', 'AbortError');

    const left = pair.before === undefined ? null : asRecord(pair.before.row, headerBefore);
    const right = pair.after === undefined ? null : asRecord(pair.after.row, headerAfter);

    const cells: CsvCell[] = [];
    let changedCells = 0;

    for (const column of columns) {
      if (column.ignored) {
        // Counted, not hidden: Rule 3 means a suppressed difference is still
        // reported as suppressed.
        const differs =
          left !== null &&
          right !== null &&
          normalise(left.get(column.name) ?? '', options) !==
            normalise(right.get(column.name) ?? '', options);
        if (differs) stats.suppressed += 1;
        cells.push({
          value: right?.get(column.name) ?? left?.get(column.name) ?? '',
          state: 'ign',
        });
        continue;
      }

      if (left === null) {
        cells.push({ value: right?.get(column.name) ?? '', state: 'add' });
        continue;
      }
      if (right === null) {
        cells.push({ value: left.get(column.name) ?? '', state: 'del' });
        continue;
      }

      const was = left.get(column.name) ?? '';
      const now = right.get(column.name) ?? '';
      if (normalise(was, options) === normalise(now, options)) {
        cells.push({ value: now, state: 'same' });
        continue;
      }
      // v0.2.6: a cell that differs only by a normalisation rule is not a change,
      // and the rule that hid it is named in the notes.
      if (
        !normalizer.inert &&
        normalizer.equivalent(normalise(was, options), normalise(now, options))
      ) {
        stats.suppressed += 1;
        cells.push({ value: now, state: 'ign' });
        continue;
      }
      cells.push({ value: now, was, state: 'chg' });
      changedCells += 1;
    }

    const status: CsvRowStatus =
      left === null ? 'add' : right === null ? 'del' : changedCells > 0 ? 'mod' : 'same';

    if (status === 'add') stats.added += 1;
    else if (status === 'del') stats.removed += 1;
    else if (status === 'mod') {
      stats.modified += 1;
      stats.changedCells += changedCells;
    } else stats.identical += 1;

    rows.push({
      key:
        keyColumn === null
          ? String(position + 1)
          : ((right ?? left)?.get(keyColumn) ?? String(position + 1)),
      status,
      ...(pair.before !== undefined ? { before: pair.before.index + 1 } : {}),
      ...(pair.after !== undefined ? { after: pair.after.index + 1 } : {}),
      cells,
      changedCells,
    });
  }

  const notes: string[] = [...normalizer.notes()];
  notes.push(
    `Read as ${delimiterName(beforeTable.delimiter)}-delimited${
      options.hasHeader ? ' with a header row' : ', with no header row'
    }.`,
  );
  notes.push(
    keyColumn === null
      ? 'Rows paired by position, then matched up by similarity — order matters.'
      : `Rows paired on "${keyColumn}", so row order is ignored.`,
  );
  if (options.keyColumn !== '' && keyColumn === null) {
    notes.push(
      `There is no column called "${options.keyColumn}", so rows were paired by position.`,
    );
  }
  if (keyed !== null && keyed.duplicates > 0) {
    notes.push(
      `${keyed.duplicates} duplicate key${keyed.duplicates === 1 ? '' : 's'} paired in file order.`,
    );
  }
  if (options.trimCells) notes.push('Leading and trailing spaces in cells were ignored.');
  if (options.ignoreCase) notes.push('Cell comparison ignored case.');
  if (options.ignoreColumns.length > 0) {
    notes.push(
      `Ignored column${options.ignoreColumns.length === 1 ? '' : 's'}: ${options.ignoreColumns.join(', ')}.`,
    );
  }
  const ragged = beforeTable.ragged + afterTable.ragged;
  if (ragged > 0) {
    notes.push(`${ragged} row${ragged === 1 ? '' : 's'} had a different number of fields.`);
  }
  const partial = beforeTable.truncated || afterTable.truncated;
  if (partial) {
    notes.push(
      `Stopped after ${MAX_ROWS.toLocaleString()} rows per file — this is a partial comparison.`,
    );
  }

  return {
    data: {
      columns,
      rows,
      delimiter: beforeTable.delimiter,
      keyColumn,
      counts: { before: beforeRows.length, after: afterRows.length },
      partial,
    },
    stats,
    notes,
  };
}
