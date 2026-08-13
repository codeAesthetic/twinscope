import { mkdtemp, open, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { largeTextEngine } from './index';
import { DEFAULT_TEXT_OPTIONS } from '../text/textDiff';
import type { EngineCtx, HostFs, InputRef } from '../types';

/**
 * The §3.8 budget measurement for large-file mode (v0.2.8), opt-in.
 *
 * MD §31's target is a **1 GB log pair navigable in under 10 s**, and a number in a
 * plan that nobody produced is a guess. This writes two real multi-hundred-megabyte
 * logs and times the real engine over the real filesystem — which is also why it is
 * not in the gate: it needs gigabytes of scratch disk and tens of seconds.
 *
 *   TWINSCOPE_PERF=1 npx vitest run src/engines/large/perf.test.ts
 *   TWINSCOPE_PERF=1 TWINSCOPE_PERF_MB=512 npx vitest run src/engines/large/perf.test.ts
 */

const enabled = process.env['TWINSCOPE_PERF'] === '1';
const megabytes = Number(process.env['TWINSCOPE_PERF_MB'] ?? '256');

const nodeFs: HostFs = {
  readText: () => Promise.reject(new Error('not used')),
  readBytes: () => Promise.reject(new Error('not used')),
  listDir: () => Promise.resolve([]),
  stat: async (path) => {
    const info = await stat(path);
    return { size: info.size, mtimeMs: info.mtimeMs };
  },
  hashFile: () => Promise.reject(new Error('not used')),
  readRange: async (path, start, length) => {
    const handle = await open(path, 'r');
    try {
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, start);
      return new Uint8Array(buffer.subarray(0, bytesRead));
    } finally {
      await handle.close();
    }
  },
};

/** A log-shaped file of about `mb` megabytes, with one line altered near the end. */
async function writeLog(path: string, mb: number, alter: boolean): Promise<number> {
  const handle = await open(path, 'w');
  let written = 0;
  let line = 0;
  try {
    const target = mb * 1024 * 1024;
    while (written < target) {
      const chunk: string[] = [];
      for (let at = 0; at < 20_000; at += 1) {
        line += 1;
        const stamp = new Date(1_700_000_000_000 + line * 1000).toISOString();
        chunk.push(
          `${stamp} INFO  worker[${line % 8}] request ${line} completed in ${line % 97}ms`,
        );
      }
      const text = `${chunk.join('\n')}\n`;
      written += Buffer.byteLength(text);
      await handle.write(text);
    }
    // One changed line, deep in the file: the interesting case is finding a needle
    // without reading the haystack.
    if (alter) await handle.write('CHANGED the last line of the file\n');
    else await handle.write('unchanged the last line of the file\n');
  } finally {
    await handle.close();
  }
  return written;
}

describe.skipIf(!enabled)('large-file mode performance (§3.8)', () => {
  it(`indexes and diffs a ${megabytes * 2} MB pair`, async () => {
    const dir = await mkdtemp(join(tmpdir(), 'twinscope-perf-'));
    const pathA = join(dir, 'a.log');
    const pathB = join(dir, 'b.log');

    try {
      await writeLog(pathA, megabytes, false);
      await writeLog(pathB, megabytes, true);

      const sizes = await Promise.all([stat(pathA), stat(pathB)]);
      const ref = (side: 'A' | 'B', path: string, size: number): InputRef => ({
        side,
        kind: 'text',
        name: path,
        path,
        size,
      });
      const ctx: EngineCtx = {
        signal: new AbortController().signal,
        progress: vi.fn(),
        fs: nodeFs,
      };

      const startedAt = Date.now();
      const result = await largeTextEngine.compare(
        ref('A', pathA, sizes[0].size),
        ref('B', pathB, sizes[1].size),
        { ...DEFAULT_TEXT_OPTIONS },
        ctx,
      );
      const elapsed = Date.now() - startedAt;

      const total = (sizes[0].size + sizes[1].size) / 1024 / 1024;
      console.info(
        `[perf] ${total.toFixed(0)} MB pair, ${result.summary.extra?.['lines']} lines: ${elapsed} ms ` +
          `(${(total / (elapsed / 1000)).toFixed(0)} MB/s), ${result.summary.extra?.['blocks']} blocks, ` +
          `${result.summary.extra?.['windows']} windows, heap ${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(0)} MB`,
      );

      expect(
        result.summary.added + result.summary.removed + result.summary.modified,
      ).toBeGreaterThan(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 600_000);
});
