/**
 * A block index over a file too large to hold in memory (v0.2.8, MD §31).
 *
 * The index is the whole trick behind large-file mode: instead of the file, keep
 * one entry per *block* of lines — where that block starts in bytes, and a hash of
 * its content. A gigabyte of log at 64 lines a block comes to about 156 000
 * entries, which is a few megabytes, and the file itself is never held anywhere.
 *
 * Two decisions worth knowing:
 *
 *  - **Nothing is decoded here.** The scan looks for the byte `0x0A` and hashes
 *    raw bytes. Decoding a gigabyte into strings costs more than everything else
 *    in this file put together, and a chunked `TextDecoder` has to carry partial
 *    sequences across every boundary. The cost is that anchoring is byte-exact:
 *    a CRLF file and an LF file share no block hashes at all. The engine says so.
 *  - **Two 32-bit hashes, not one.** 156 000 blocks against a single 32-bit hash
 *    expects a collision or three (birthday), and a collision here silently
 *    anchors two blocks that differ. Combined into one 16-character key, the
 *    chance is negligible.
 */

/** Ranged reads over one file. The host supplies it; see `HostFs.readRange`. */
export interface RangeReader {
  size: number;
  read(start: number, length: number): Promise<Uint8Array>;
}

export interface BlockIndex {
  /** Lines per block, as built. */
  blockLines: number;
  /**
   * Byte offset of each block's first line, plus a final entry equal to the file
   * size — so block `i` is exactly `[offsets[i], offsets[i + 1])`.
   */
  offsets: number[];
  /** One content hash per block. `offsets.length === hashes.length + 1`. */
  hashes: string[];
  /** Total lines, counted as `split('\n')` would: newlines + 1. */
  lines: number;
  bytes: number;
}

export const DEFAULT_BLOCK_LINES = 64;

/** Read size for the index pass. Big enough to amortise the call, small enough to hold. */
export const CHUNK_BYTES = 1024 * 1024;

const NEWLINE = 0x0a;

export interface IndexOptions {
  blockLines?: number;
  chunkBytes?: number;
  signal?: AbortSignal;
  /** Called with a 0–1 fraction of the file scanned. */
  onProgress?: (fraction: number) => void;
}

/**
 * The line number (1-based) the given block starts at.
 *
 * Derived rather than stored: blocks are a fixed number of lines by construction,
 * so an array of first-line numbers would be a second copy of `i * blockLines`.
 */
export function blockFirstLine(index: BlockIndex, block: number): number {
  return block * index.blockLines + 1;
}

/** Lines in a half-open range of blocks, clamped to the file's real line count. */
export function blockLineCount(index: BlockIndex, start: number, end: number): number {
  const from = blockFirstLine(index, start);
  const to = Math.min(index.lines + 1, blockFirstLine(index, end));
  return Math.max(0, to - from);
}

export async function buildIndex(
  reader: RangeReader,
  options: IndexOptions = {},
): Promise<BlockIndex> {
  const blockLines = options.blockLines ?? DEFAULT_BLOCK_LINES;
  const chunkBytes = options.chunkBytes ?? CHUNK_BYTES;

  const offsets: number[] = [0];
  const hashes: string[] = [];

  let newlines = 0;
  let linesInBlock = 0;
  // FNV-1a and a djb2 variant over the same bytes, in one pass.
  let h1 = 0x811c9dc5;
  let h2 = 5381;
  let sawBytesInBlock = false;

  let position = 0;
  while (position < reader.size) {
    if (options.signal?.aborted === true) {
      throw new DOMException('Comparison cancelled', 'AbortError');
    }

    const length = Math.min(chunkBytes, reader.size - position);
    const chunk = await reader.read(position, length);
    if (chunk.length === 0) break;

    for (let at = 0; at < chunk.length; at += 1) {
      const byte = chunk[at] as number;
      sawBytesInBlock = true;

      h1 = (h1 ^ byte) >>> 0;
      h1 = Math.imul(h1, 0x01000193) >>> 0;
      h2 = (Math.imul(h2, 33) ^ byte) >>> 0;

      if (byte !== NEWLINE) continue;

      newlines += 1;
      linesInBlock += 1;
      if (linesInBlock < blockLines) continue;

      hashes.push(hashKey(h1, h2));
      offsets.push(position + at + 1);
      linesInBlock = 0;
      h1 = 0x811c9dc5;
      h2 = 5381;
      sawBytesInBlock = false;
    }

    position += chunk.length;
    options.onProgress?.(reader.size === 0 ? 1 : position / reader.size);
  }

  // The tail: bytes after the last complete block, whether or not they end in a
  // newline. Without this a file whose length is not a multiple of the block size
  // loses its last lines, which is nearly every file.
  if (sawBytesInBlock) {
    hashes.push(hashKey(h1, h2));
    offsets.push(reader.size);
  } else if (offsets[offsets.length - 1] !== reader.size) {
    offsets[offsets.length - 1] = reader.size;
  }

  return {
    blockLines,
    offsets,
    hashes,
    // `'a\nb'.split('\n')` is two lines and `'a\n'.split('\n')` is two as well —
    // the trailing empty one. Matching `split` keeps every line number in this
    // engine comparable with the ones the text engine reports.
    lines: reader.size === 0 ? 0 : newlines + 1,
    bytes: reader.size,
  };
}

function hashKey(h1: number, h2: number): string {
  return `${h1.toString(36)}.${h2.toString(36)}`;
}
