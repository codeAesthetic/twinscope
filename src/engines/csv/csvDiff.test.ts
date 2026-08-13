import { describe, expect, it } from 'vitest';
import { delimiterName, MAX_ROWS, parseCsv, sniffDelimiter } from './parseCsv';
import { DEFAULT_CSV_OPTIONS, diffCsv, type CsvDiffOptions } from './csvDiff';
import { csvEngine } from './index';
import type { EngineCtx, InputRef } from '../types';

const options = (patch: Partial<CsvDiffOptions> = {}): CsvDiffOptions => ({
  ...DEFAULT_CSV_OPTIONS,
  ignoreColumns: [],
  ...patch,
});

describe('parseCsv', () => {
  it('reads the simple case', () => {
    expect(parseCsv('a,b\n1,2\n').records).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('keeps a delimiter that is inside a quoted field', () => {
    expect(parseCsv('a,"b,c",d\n').records).toEqual([['a', 'b,c', 'd']]);
  });

  it('keeps a NEWLINE that is inside a quoted field', () => {
    // A CSV record is not a line. Splitting on \n first is how every hand-rolled
    // parser gets this wrong.
    expect(parseCsv('a,"line one\nline two",c\n').records).toEqual([
      ['a', 'line one\nline two', 'c'],
    ]);
  });

  it('un-escapes a doubled quote', () => {
    expect(parseCsv('a,"say ""hi""",c\n').records).toEqual([['a', 'say "hi"', 'c']]);
  });

  it('handles CRLF, a lone CR, and a missing final newline', () => {
    expect(parseCsv('a,b\r\n1,2\r\n').records).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
    expect(parseCsv('a,b\r1,2').records).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
    expect(parseCsv('a,b\n1,2').records).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('does not invent a trailing empty record', () => {
    expect(parseCsv('a\nb\n').records).toHaveLength(2);
  });

  it('keeps empty fields, which are data', () => {
    expect(parseCsv('a,,c\n').records).toEqual([['a', '', 'c']]);
    expect(parseCsv(',,\n').records).toEqual([['', '', '']]);
  });

  it('counts ragged rows rather than padding them silently', () => {
    expect(parseCsv('a,b,c\n1,2\n').ragged).toBe(1);
  });

  it('sniffs the delimiter outside quotes, so a comma in a field does not win', () => {
    // The European case: semicolon-delimited, with commas inside the values.
    expect(sniffDelimiter('name;note\nAda;"one, two"\n')).toBe(';');
    expect(sniffDelimiter('a\tb\n1\t2\n')).toBe('\t');
    expect(sniffDelimiter('a,b\n1,2\n')).toBe(',');
    // An explicit hint always wins.
    expect(sniffDelimiter('a,b\n', '|')).toBe('|');
  });

  it('names delimiters for the notes', () => {
    expect(delimiterName('\t')).toBe('tab');
    expect(delimiterName(';')).toBe('semicolon');
    expect(delimiterName('#')).toBe('"#"');
  });

  it('stops at the row guard', () => {
    const many = `${'a\n'.repeat(MAX_ROWS + 10)}`;
    const table = parseCsv(many);
    expect(table.truncated).toBe(true);
    expect(table.records.length).toBeLessThanOrEqual(MAX_ROWS);
  });
});

describe('diffCsv — pairing by position', () => {
  it('reports one addition for an inserted row, not a shifted file', () => {
    // The bug this exists to prevent: comparing index-by-index makes every row
    // after an insertion look modified.
    const before = 'id,name\n1,Ada\n2,Bob\n3,Cy\n';
    const after = 'id,name\n1,Ada\n9,New\n2,Bob\n3,Cy\n';
    const { stats } = diffCsv(before, after, options());
    expect(stats).toMatchObject({ added: 1, removed: 0, modified: 0, identical: 3 });
  });

  it('pairs an edited row as one modification, with the changed cell marked', () => {
    const { data, stats } = diffCsv(
      'id,name,city\n1,Ada,London\n',
      'id,name,city\n1,Ada,Cambridge\n',
      options(),
    );
    expect(stats).toMatchObject({ added: 0, removed: 0, modified: 1, changedCells: 1 });

    const row = data.rows[0];
    expect(row?.status).toBe('mod');
    expect(row?.cells.map((cell) => cell.state)).toEqual(['same', 'same', 'chg']);
    expect(row?.cells[2]).toMatchObject({ was: 'London', value: 'Cambridge' });
  });

  it('keeps a wholly different row as a removal and an addition', () => {
    // Below the similarity threshold there is no edit to describe. Three columns,
    // because similarity is only judged when there are enough to judge by.
    const { stats } = diffCsv(
      'id,name,city\n1,Ada,London\n',
      'id,name,city\n7,Zoë,Oslo\n',
      options(),
    );
    expect(stats).toMatchObject({ added: 1, removed: 1, modified: 0 });
  });

  it('treats a narrow table’s changed row as an edit, since nothing can be judged', () => {
    // One column: a changed cell means zero cells match, so any threshold would
    // report every edit as a deletion plus an addition.
    expect(diffCsv('a\nx\n', 'a\ny\n', options()).stats).toMatchObject({
      modified: 1,
      added: 0,
      removed: 0,
    });
  });

  it('records the source row numbers on each side', () => {
    const { data } = diffCsv('id\n1\n2\n', 'id\n1\n2\n3\n', options());
    expect(data.rows.map((row) => [row.before, row.after])).toEqual([
      [1, 1],
      [2, 2],
      [undefined, 3],
    ]);
  });
});

describe('diffCsv — pairing by key', () => {
  const before = 'id,name,city\n1,Ada,London\n2,Bob,Leeds\n3,Cy,Hull\n';
  // Same three records, shuffled, with one edit and one deletion.
  const after = 'id,name,city\n3,Cy,Hull\n1,Ada,Cambridge\n4,Dee,York\n';

  it('ignores row order entirely', () => {
    const { stats, data } = diffCsv(before, after, options({ keyColumn: 'id' }));
    expect(stats).toMatchObject({ added: 1, removed: 1, modified: 1, identical: 1 });
    expect(data.keyColumn).toBe('id');
  });

  it('reports the same pair as mostly-changed when paired by position', () => {
    // Same two files, no key: order now matters, and the answer is different but
    // not wrong — which is exactly why the option exists.
    const byPosition = diffCsv(before, after, options());
    expect(byPosition.stats.identical).toBeLessThan(3);
  });

  it('says which column it paired on', () => {
    const { notes } = diffCsv(before, after, options({ keyColumn: 'id' }));
    expect(notes.join(' ')).toContain('paired on "id", so row order is ignored');
  });

  it('falls back to position when the named column does not exist, and says so', () => {
    const { data, notes } = diffCsv(before, after, options({ keyColumn: 'nope' }));
    expect(data.keyColumn).toBeNull();
    expect(notes.join(' ')).toContain('There is no column called "nope"');
  });

  it('pairs duplicate keys in file order and counts them', () => {
    const { notes, stats } = diffCsv(
      'id,v\n1,a\n1,b\n',
      'id,v\n1,a\n1,c\n',
      options({ keyColumn: 'id' }),
    );
    expect(stats).toMatchObject({ identical: 1, modified: 1 });
    expect(notes.join(' ')).toContain('1 duplicate key');
  });
});

describe('diffCsv — columns', () => {
  it('marks a column that only one side has', () => {
    const { data, stats } = diffCsv('id,name\n1,Ada\n', 'id,name,email\n1,Ada,a@b.c\n', options());
    expect(data.columns.map((column) => [column.name, column.status])).toEqual([
      ['id', 'same'],
      ['name', 'same'],
      ['email', 'add'],
    ]);
    expect(stats.addedColumns).toBe(1);
    // A new column with a value in it is a change to that row.
    expect(stats.modified).toBe(1);
  });

  it('keeps BEFORE column order, then appends the new ones', () => {
    const { data } = diffCsv('b,a\n1,2\n', 'a,c\n2,3\n', options());
    expect(data.columns.map((column) => column.name)).toEqual(['b', 'a', 'c']);
  });

  it('suppresses an ignored column but still counts the difference — Rule 3', () => {
    const { stats, data } = diffCsv(
      'id,updated\n1,2026-01-01\n',
      'id,updated\n1,2026-08-13\n',
      options({ ignoreColumns: ['updated'] }),
    );
    expect(stats.modified).toBe(0);
    expect(stats.suppressed).toBe(1);
    expect(data.columns[1]?.ignored).toBe(true);
  });

  it('names the ignored columns in the notes', () => {
    const { notes } = diffCsv('a,b\n1,2\n', 'a,b\n1,3\n', options({ ignoreColumns: ['b'] }));
    expect(notes.join(' ')).toContain('Ignored column: b');
  });
});

describe('diffCsv — normalisation', () => {
  it('trims cells by default, and says so', () => {
    const { stats, notes } = diffCsv('a\n x \n', 'a\nx\n', options());
    expect(stats.modified).toBe(0);
    expect(notes.join(' ')).toContain('Leading and trailing spaces');
  });

  it('can be told not to trim', () => {
    expect(diffCsv('a\n x \n', 'a\nx\n', options({ trimCells: false })).stats.modified).toBe(1);
  });

  it('can ignore case', () => {
    expect(diffCsv('a\nAda\n', 'a\nADA\n', options()).stats.modified).toBe(1);
    expect(diffCsv('a\nAda\n', 'a\nADA\n', options({ ignoreCase: true })).stats.modified).toBe(0);
  });

  it('treats the first row as data when told there is no header', () => {
    const withHeader = diffCsv('id\n1\n', 'id\n2\n', options());
    const without = diffCsv('id\n1\n', 'id\n2\n', options({ hasHeader: false }));
    expect(withHeader.data.counts.before).toBe(1);
    expect(without.data.counts.before).toBe(2);
    expect(without.data.columns[0]?.name).toBe('Column 1');
  });

  it('names an empty header cell rather than leaving a blank column', () => {
    const { data } = diffCsv('id,\n1,2\n', 'id,\n1,2\n', options());
    expect(data.columns.map((column) => column.name)).toEqual(['id', 'Column 2']);
  });
});

describe('the csv engine', () => {
  const ctx = (): EngineCtx => ({
    signal: new AbortController().signal,
    progress: () => undefined,
  });

  const ref = (side: 'A' | 'B', name: string, text: string): InputRef => ({
    side,
    kind: 'csv',
    name,
    size: text.length,
    text,
  });

  it('claims two CSVs and nothing else', () => {
    const csv = ref('A', 'a.csv', '');
    expect(csvEngine.canHandle(csv, ref('B', 'b.csv', ''))).toBe(true);
    expect(csvEngine.canHandle(csv, { ...csv, side: 'B', kind: 'text' })).toBe(false);
  });

  it('reports rows, cells and identical counts in the summary', async () => {
    const result = await csvEngine.compare(
      ref('A', 'a.csv', 'id,name\n1,Ada\n2,Bob\n'),
      ref('B', 'b.csv', 'id,name\n1,Ada Lovelace\n2,Bob\n3,Cy\n'),
      csvEngine.defaultOptions(),
      ctx(),
    );
    expect(result.engineId).toBe('csv');
    expect(result.summary).toMatchObject({ added: 1, removed: 0, modified: 1 });
    expect(result.summary.extra?.rows).toBe('2 → 3');
    expect(result.summary.extra?.identical).toBe(1);
    expect(result.summary.extra?.cells).toBe(1);
  });

  it('reads a .tsv as tab-delimited from its name, not by sniffing', async () => {
    // A TSV whose cells contain commas would otherwise sniff as comma-delimited.
    const result = await csvEngine.compare(
      ref('A', 'a.tsv', 'id\tnote\n1\tone, two\n'),
      ref('B', 'b.tsv', 'id\tnote\n1\tone, three\n'),
      csvEngine.defaultOptions(),
      ctx(),
    );
    expect((result.data as { delimiter: string }).delimiter).toBe('\t');
    expect(result.summary.modified).toBe(1);
  });

  it('honours cancellation', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      csvEngine.compare(
        ref('A', 'a.csv', 'id\n1\n'),
        ref('B', 'b.csv', 'id\n2\n'),
        csvEngine.defaultOptions(),
        { signal: controller.signal, progress: () => undefined },
      ),
    ).rejects.toThrow(/cancelled/i);
  });

  it('needs a filesystem only when the text was not inlined', async () => {
    await expect(
      csvEngine.compare(
        { side: 'A', kind: 'csv', name: 'a.csv', path: '/tmp/a.csv', size: 10 },
        { side: 'B', kind: 'csv', name: 'b.csv', path: '/tmp/b.csv', size: 10 },
        csvEngine.defaultOptions(),
        ctx(),
      ),
    ).rejects.toThrow(/No filesystem access/);
  });
});
