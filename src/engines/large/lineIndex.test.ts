import { describe, expect, it } from 'vitest';
import { blockFirstLine, blockLineCount, buildIndex, type RangeReader } from './lineIndex';

/** A `RangeReader` over a string, which is what a host provides over a file. */
function readerOf(text: string, chunkLimit = Infinity): RangeReader {
  const bytes = new TextEncoder().encode(text);
  return {
    size: bytes.length,
    read: (start, length) =>
      // Short reads are legal for a real read syscall, so the fake does them too.
      Promise.resolve(bytes.subarray(start, start + Math.min(length, chunkLimit))),
  };
}

function lines(count: number, prefix = 'line'): string {
  return Array.from({ length: count }, (_, at) => `${prefix} ${at + 1}`).join('\n');
}

describe('buildIndex', () => {
  it('counts lines the way split() does', async () => {
    expect((await buildIndex(readerOf('a\nb\nc'))).lines).toBe(3);
    // A trailing newline means a final empty line, exactly as `split` reports.
    expect((await buildIndex(readerOf('a\nb\n'))).lines).toBe(3);
    expect((await buildIndex(readerOf(''))).lines).toBe(0);
  });

  it('closes a block every N lines and keeps the tail', async () => {
    const index = await buildIndex(readerOf(`${lines(10)}\n`), { blockLines: 4 });
    // 10 lines of content plus the trailing empty one: three blocks, last short.
    expect(index.hashes).toHaveLength(3);
    expect(index.offsets).toHaveLength(4);
    expect(index.offsets[0]).toBe(0);
    expect(index.offsets[3]).toBe(index.bytes);
  });

  it('gives identical content identical hashes, whatever the read size', async () => {
    const text = `${lines(300)}\n`;
    const whole = await buildIndex(readerOf(text), { blockLines: 8 });
    // The same file read in 7-byte dribbles: block boundaries must not move.
    const dribbled = await buildIndex(readerOf(text, 7), { blockLines: 8, chunkBytes: 13 });
    expect(dribbled.hashes).toEqual(whole.hashes);
    expect(dribbled.offsets).toEqual(whole.offsets);
  });

  it('separates blocks that differ by one character', async () => {
    const a = await buildIndex(readerOf('aaa\nbbb\n'), { blockLines: 2 });
    const b = await buildIndex(readerOf('aaa\nbbc\n'), { blockLines: 2 });
    expect(a.hashes[0]).not.toBe(b.hashes[0]);
  });

  it('offsets point at the first byte of the block, so a range reads whole lines', async () => {
    const text = `${lines(9)}\n`;
    const index = await buildIndex(readerOf(text), { blockLines: 3 });
    const bytes = new TextEncoder().encode(text);

    const slice = new TextDecoder().decode(
      bytes.subarray(index.offsets[1] as number, index.offsets[2] as number),
    );
    expect(slice).toBe('line 4\nline 5\nline 6\n');
  });

  it('reports progress and honours an abort', async () => {
    const seen: number[] = [];
    await buildIndex(readerOf(`${lines(500)}\n`), {
      chunkBytes: 64,
      onProgress: (fraction) => seen.push(fraction),
    });
    expect(seen.length).toBeGreaterThan(1);
    expect(seen[seen.length - 1]).toBe(1);

    const controller = new AbortController();
    controller.abort();
    await expect(buildIndex(readerOf(lines(50)), { signal: controller.signal })).rejects.toThrow(
      /cancelled/i,
    );
  });

  it('derives line numbers and counts from the block size', async () => {
    const index = await buildIndex(readerOf(`${lines(10)}\n`), { blockLines: 4 });
    expect(blockFirstLine(index, 0)).toBe(1);
    expect(blockFirstLine(index, 2)).toBe(9);
    // Clamped to the real line count: the last block is short.
    expect(blockLineCount(index, 0, 2)).toBe(8);
    expect(blockLineCount(index, 2, 3)).toBe(3);
    expect(blockLineCount(index, 1, 1)).toBe(0);
  });
});
