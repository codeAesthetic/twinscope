/**
 * CSV parsing, to RFC 4180 (v0.2.5).
 *
 * Ours rather than a dependency, deliberately: the format is small and fully
 * specified, its three genuinely tricky cases are exactly what unit tests are for,
 * and delimiter detection has to be ours regardless — `.tsv` is tab-delimited and
 * a European CSV is usually `;`.
 *
 * The three cases, all covered below and all in the tests:
 *
 *  1. A quoted field may contain the delimiter: `a,"b,c",d` is three fields.
 *  2. A quoted field may contain a **newline**, so a CSV record is not a line and
 *     splitting on `\n` first is the classic way to get this wrong.
 *  3. A literal quote inside a quoted field is doubled: `"say ""hi"""`.
 */

/** Past this the grid stops being something a human reads, and a guard is kinder. */
export const MAX_ROWS = 200_000;
export const MAX_COLUMNS = 1_000;

export interface CsvTable {
  /** Every record, including the header row if there is one. */
  records: string[][];
  delimiter: string;
  /** True when a guard stopped the parse early. */
  truncated: boolean;
  /** Records whose field count differed from the first record's. */
  ragged: number;
}

const CANDIDATES = [',', '\t', ';', '|'] as const;

/**
 * Guesses the delimiter by counting candidates *outside* quoted fields.
 *
 * Counting raw occurrences would pick `,` for a semicolon-delimited file whose
 * fields contain commas — which is most European exports.
 */
export function sniffDelimiter(text: string, hint?: string): string {
  if (hint !== undefined && hint !== '') return hint;

  const sample = text.slice(0, 64 * 1024);
  let best = ',';
  let bestCount = 0;

  for (const candidate of CANDIDATES) {
    const count = countOutsideQuotes(sample, candidate);
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }

  return best;
}

function countOutsideQuotes(text: string, delimiter: string): number {
  let count = 0;
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      // A doubled quote inside a quoted field is an escaped quote, not a close.
      if (quoted && text[index + 1] === '"') {
        index += 1;
        continue;
      }
      quoted = !quoted;
      continue;
    }
    if (!quoted && char === delimiter) count += 1;
  }

  return count;
}

/**
 * Parses `text` into records.
 *
 * A single pass over the characters, because the alternative — split into lines,
 * then re-join the ones that turned out to be inside a quoted field — is where
 * every hand-rolled CSV parser goes wrong.
 */
export function parseCsv(text: string, delimiterHint?: string): CsvTable {
  const delimiter = sniffDelimiter(text, delimiterHint);
  const records: string[][] = [];

  let field = '';
  let record: string[] = [];
  let quoted = false;
  let truncated = false;
  // A trailing newline ends the last record rather than starting an empty one.
  let sawContent = false;

  const endField = (): void => {
    record.push(field);
    field = '';
  };

  const endRecord = (): void => {
    endField();
    if (records.length >= MAX_ROWS) {
      truncated = true;
      return;
    }
    records.push(record.slice(0, MAX_COLUMNS));
    record = [];
  };

  for (let index = 0; index < text.length && !truncated; index += 1) {
    const char = text[index] as string;

    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
          continue;
        }
        quoted = false;
        continue;
      }
      field += char;
      sawContent = true;
      continue;
    }

    if (char === '"') {
      quoted = true;
      sawContent = true;
      continue;
    }

    if (char === delimiter) {
      endField();
      sawContent = true;
      continue;
    }

    if (char === '\r') {
      // CRLF and a lone CR both end a record; the \n is consumed with it.
      if (text[index + 1] === '\n') index += 1;
      endRecord();
      sawContent = false;
      continue;
    }

    if (char === '\n') {
      endRecord();
      sawContent = false;
      continue;
    }

    field += char;
    sawContent = true;
  }

  // Whatever is left is a final record, unless the file simply ended in a newline.
  if (!truncated && (sawContent || field !== '' || record.length > 0)) endRecord();

  const width = records[0]?.length ?? 0;
  const ragged = records.filter((row) => row.length !== width).length;

  return { records, delimiter, truncated, ragged };
}

/** How a delimiter reads in a note. */
export function delimiterName(delimiter: string): string {
  if (delimiter === '\t') return 'tab';
  if (delimiter === ',') return 'comma';
  if (delimiter === ';') return 'semicolon';
  if (delimiter === '|') return 'pipe';
  return `"${delimiter}"`;
}
