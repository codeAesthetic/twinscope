import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { decodeText } from '../engines/encoding';
import { isInside, normalisePath } from '../shared/paths';
import type { HostFs } from '../engines/types';

/**
 * A path with every symlink resolved.
 *
 * A path that does not exist has no real form, so it is judged by where it
 * *would* live: a folder scan legitimately stats files that vanish mid-walk, and
 * that has to surface as a missing file rather than as a security error.
 */
async function toReal(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    try {
      return join(await realpath(dirname(path)), basename(path));
    } catch {
      return path;
    }
  }
}

/**
 * Confines a `HostFs` to the roots of the job it is running (plan §3.7 item 5).
 *
 * This is where "must not escape user-picked roots" is actually enforceable: the
 * user chose two inputs, every legitimate read is one of them or — for a folder
 * comparison — something beneath one of them, and the engine worker is the only
 * process that performs those reads.
 *
 * The check is on the **real** path, so a symlink planted inside a scanned tree
 * cannot be used to read its way out. `realpath` on a path that does not exist
 * throws, so the containment check falls back to the parent directory: a folder
 * scan legitimately stats files that have just been deleted, and that should
 * surface as a missing file rather than as a security error.
 */
export function scopedHostFs(base: HostFs, roots: readonly string[]): HostFs {
  const declared = roots.map(normalisePath);

  /**
   * The roots in *real* terms, resolved once and reused.
   *
   * Both sides of the comparison have to be real or neither is: on macOS
   * `/var` is itself a symlink to `/private/var`, so a resolved path under a
   * temp directory never matches an unresolved root and every legitimate read
   * is refused.
   */
  let resolvedRoots: Promise<string[]> | undefined;
  const realRoots = (): Promise<string[]> => {
    resolvedRoots ??= Promise.all(declared.map((root) => toReal(root)));
    return resolvedRoots;
  };

  const check = async (raw: string): Promise<string> => {
    const path = normalisePath(raw);
    // Resolve symlinks before deciding. A link inside a scanned folder that
    // points at /etc is exactly the escape this exists to stop.
    const real = await toReal(path);

    const allowed = await realRoots();
    if (allowed.some((root) => isInside(root, real))) return path;
    throw new Error(`Refusing to read outside the compared inputs: ${raw}`);
  };

  return {
    readText: async (path) => base.readText(await check(path)),
    readBytes: async (path) => base.readBytes(await check(path)),
    listDir: async (path) => base.listDir(await check(path)),
    stat: async (path) => base.stat(await check(path)),
    hashFile: async (path) => base.hashFile(await check(path)),
  };
}

/**
 * The real filesystem, in the shape engines are allowed to see.
 *
 * Engines never import `fs`: they get this through `EngineCtx.fs`, which is what
 * lets the same engine code run in the CLI (v0.2.2) and in tests against a fake.
 * It lives in its own file so the tests can exercise the genuine implementation
 * rather than a copy of it. `scopedHostFs` wraps it per job; nothing outside
 * this file should use it unwrapped.
 */
export const nodeHostFs: HostFs = {
  // Decoded rather than assumed UTF-8: a UTF-16 file read as UTF-8 is a wall of
  // NULs, and a byte-order mark becomes an invisible difference on line 1.
  readText: async (path) => decodeText(new Uint8Array(await readFile(path))).text,

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
