import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { HostFs } from '../engines/types';

/**
 * The real filesystem, in the shape engines are allowed to see.
 *
 * Engines never import `fs`: they get this through `EngineCtx.fs`, which is what
 * lets the same engine code run in the CLI (V1-2) and in tests against a fake.
 * It lives in its own file so the tests can exercise the genuine implementation
 * rather than a copy of it.
 */
export const nodeHostFs: HostFs = {
  readText: (path) => readFile(path, 'utf8'),

  readBytes: async (path) => new Uint8Array(await readFile(path)),

  listDir: async (path) => {
    const entries = await readdir(path, { withFileTypes: true });
    return entries.map((entry) => ({
      name: entry.name,
      path: join(path, entry.name),
      isDirectory: entry.isDirectory(),
      isSymlink: entry.isSymbolicLink(),
    }));
  },

  stat: async (path) => {
    const info = await stat(path);
    return { size: info.size, mtimeMs: info.mtimeMs };
  },

  /** Streamed so hashing a 2 GB file costs a buffer, not 2 GB of heap. */
  hashFile: (path) =>
    new Promise((resolve, reject) => {
      const hash = createHash('sha256');
      const stream = createReadStream(path);
      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('error', reject);
      stream.on('end', () => resolve(hash.digest('hex')));
    }),
};
