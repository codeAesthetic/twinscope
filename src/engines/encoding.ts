/**
 * Text decoding (MD §31, MVP-11).
 *
 * Reading every file as UTF-8 is right until it isn't: a UTF-16 file decoded as
 * UTF-8 becomes a wall of NULs and reads as "binary", and a byte-order mark
 * decoded as text becomes an invisible first character that makes line 1 differ
 * from an otherwise identical line 1.
 *
 * Pure: takes bytes, returns a string and what it had to assume.
 */

export type Encoding = 'utf-8' | 'utf-8-bom' | 'utf-16le' | 'utf-16be' | 'latin1';
export type Eol = 'LF' | 'CRLF' | 'CR' | 'none';

export interface DecodedText {
  text: string;
  encoding: Encoding;
  eol: Eol;
  /** True when the bytes were not valid in their apparent encoding. */
  lossy: boolean;
}

/** Below this, the alternating-NUL heuristic has nothing to work with. */
const MIN_HEURISTIC_BYTES = 32;

/** Byte-order marks, longest first so UTF-8's three bytes win over a prefix. */
const BOMS: Array<{ bytes: number[]; encoding: Encoding }> = [
  { bytes: [0xef, 0xbb, 0xbf], encoding: 'utf-8-bom' },
  { bytes: [0xff, 0xfe], encoding: 'utf-16le' },
  { bytes: [0xfe, 0xff], encoding: 'utf-16be' },
];

function startsWith(bytes: Uint8Array, prefix: readonly number[]): boolean {
  if (bytes.length < prefix.length) return false;
  return prefix.every((byte, index) => bytes[index] === byte);
}

/**
 * What these bytes most likely are.
 *
 * A BOM is definitive. Without one, a run of alternating NULs is the tell for
 * UTF-16 — which is also why the NUL-based binary sniff has to run *after* this.
 */
export function detectEncoding(bytes: Uint8Array): Encoding {
  for (const { bytes: prefix, encoding } of BOMS) {
    if (startsWith(bytes, prefix)) return encoding;
  }

  const sample = bytes.subarray(0, 1024);

  // A handful of bytes cannot establish a pattern: a six-byte executable header
  // happens to look like UTF-16 often enough to matter, and calling it text is
  // worse than missing a tiny unmarked UTF-16 file (which a BOM would catch).
  if (sample.length < MIN_HEURISTIC_BYTES) return 'utf-8';

  let evenNuls = 0;
  let oddNuls = 0;
  for (let index = 0; index < sample.length; index += 1) {
    if (sample[index] !== 0) continue;
    if (index % 2 === 0) evenNuls += 1;
    else oddNuls += 1;
  }

  // A quarter of the bytes in one position being NUL, and none in the other, is
  // not something UTF-8 text does.
  const threshold = sample.length / 4;
  if (oddNuls > threshold && evenNuls === 0) return 'utf-16le';
  if (evenNuls > threshold && oddNuls === 0) return 'utf-16be';

  return 'utf-8';
}

export function detectEol(text: string): Eol {
  const crlf = text.includes('\r\n');
  const lf = /(?<!\r)\n/.test(text);
  const cr = /\r(?!\n)/.test(text);

  if (crlf && !lf && !cr) return 'CRLF';
  if (crlf) return 'CRLF'; // Mixed endings: report the one that surprises people.
  if (lf) return 'LF';
  if (cr) return 'CR';
  return 'none';
}

function decodeWith(bytes: Uint8Array, label: string, fatal: boolean): string | null {
  try {
    return new TextDecoder(label, { fatal }).decode(bytes);
  } catch {
    return null;
  }
}

/**
 * Decodes, falling back rather than failing.
 *
 * An undecodable file still deserves a comparison — latin1 maps every byte to a
 * character, so the diff is at least byte-accurate even when it is not readable.
 * `lossy` says that happened so the UI can warn instead of pretending.
 */
export function decodeText(bytes: Uint8Array): DecodedText {
  const encoding = detectEncoding(bytes);

  const body =
    encoding === 'utf-8-bom'
      ? bytes.subarray(3)
      : encoding === 'utf-16le' || encoding === 'utf-16be'
        ? bytes.subarray(2)
        : bytes;

  const label =
    encoding === 'utf-16le' ? 'utf-16le' : encoding === 'utf-16be' ? 'utf-16be' : 'utf-8';

  const strict = decodeWith(body, label, true);
  if (strict !== null) {
    return { text: strict, encoding, eol: detectEol(strict), lossy: false };
  }

  const latin1 = decodeWith(body, 'latin1', false) ?? '';
  return { text: latin1, encoding: 'latin1', eol: detectEol(latin1), lossy: true };
}

/** A NUL in decoded text is the classic binary tell — checked after decoding. */
export function looksBinaryText(text: string): boolean {
  return text.slice(0, 8192).includes('\0');
}

export function describeEncoding(encoding: Encoding): string {
  switch (encoding) {
    case 'utf-8':
      return 'UTF-8';
    case 'utf-8-bom':
      return 'UTF-8 BOM';
    case 'utf-16le':
      return 'UTF-16 LE';
    case 'utf-16be':
      return 'UTF-16 BE';
    case 'latin1':
      return 'Latin-1';
  }
}
