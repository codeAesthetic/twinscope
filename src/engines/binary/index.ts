import type { DiffEngine, DiffResult, InputRef } from '../types';

/**
 * Binary comparison (MVP-11).
 *
 * Line-diffing a compiled binary produces pages of mojibake and answers nothing.
 * The only questions worth asking are: are these the same bytes, and if not, how
 * do they differ in size? Both are cheap and both are useful.
 */

export interface BinaryDiffOptions {
  /** Hashing a multi-gigabyte pair is the one slow thing here. */
  compareContentHash: boolean;
}

export interface BinaryDiffData {
  identical: boolean;
  before: { name: string; size: number; hash?: string };
  after: { name: string; size: number; hash?: string };
  /** Positive when the after side grew. */
  sizeDelta: number;
}

export const binaryEngine: DiffEngine<BinaryDiffOptions, BinaryDiffData> = {
  // Above every other engine: once both sides sniff as binary, nothing else has
  // anything useful to say about them.
  meta: { id: 'binary', label: 'Binary comparison', priority: 60 },

  canHandle: (a, b) => a.kind === 'binary' && b.kind === 'binary',

  defaultOptions: () => ({ compareContentHash: true }),

  async compare(a, b, options, ctx): Promise<DiffResult<BinaryDiffData>> {
    const startedAt = Date.now();

    ctx.progress(20, 'measuring');
    const sizes = { before: a.size, after: b.size };

    let hashes: { before?: string; after?: string } = {};
    let identical = sizes.before === sizes.after;

    // A size difference is already conclusive, so hashing only runs when the
    // sizes match and the answer is still open.
    if (identical && options.compareContentHash && ctx.fs !== undefined) {
      if (a.path !== undefined && b.path !== undefined) {
        ctx.progress(50, 'hashing');
        const [before, after] = await Promise.all([
          ctx.fs.hashFile(a.path),
          ctx.fs.hashFile(b.path),
        ]);
        hashes = { before, after };
        identical = before === after;
      }
    }

    if (ctx.signal.aborted) throw new DOMException('Comparison cancelled', 'AbortError');
    ctx.progress(100, 'done');

    const notes = [
      identical
        ? 'These files are byte-for-byte identical.'
        : 'Binary files are compared by size and content hash, not line by line.',
    ];
    if (!options.compareContentHash) notes.push('Content hashing was turned off.');

    return {
      engineId: 'binary',
      summary: {
        added: 0,
        removed: 0,
        modified: identical ? 0 : 1,
        extra: {
          verdict: identical ? 'identical' : 'different',
          ...(sizes.after !== sizes.before ? { bytes: sizes.after - sizes.before } : {}),
        },
      },
      data: {
        identical,
        before: {
          name: a.name,
          size: sizes.before,
          ...(hashes.before !== undefined ? { hash: hashes.before } : {}),
        },
        after: {
          name: b.name,
          size: sizes.after,
          ...(hashes.after !== undefined ? { hash: hashes.after } : {}),
        },
        sizeDelta: sizes.after - sizes.before,
      },
      normalizationNotes: notes,
      timings: { ms: Date.now() - startedAt },
    };
  },
};

/** Kept beside the engine so a view can format the same way. */
export function formatBytes(bytes: number): string {
  const size = Math.abs(bytes);
  const sign = bytes < 0 ? '−' : '';
  if (size < 1024) return `${sign}${size} B`;
  if (size < 1024 * 1024) return `${sign}${(size / 1024).toFixed(1)} KB`;
  return `${sign}${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function refIsBinary(input: InputRef): boolean {
  return input.kind === 'binary';
}
