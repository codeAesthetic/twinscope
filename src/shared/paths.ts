import { isAbsolute, resolve, sep } from 'node:path';

/**
 * Path hygiene and containment (plan §3.7 item 5).
 *
 * Two separate properties, worth keeping apart because only one of them can be
 * made absolute:
 *
 *  1. **Normalisation** — every path that crosses the IPC boundary is absolute,
 *     free of NUL bytes and reduced to canonical form before anything touches
 *     the filesystem with it. This is complete: there is no input that gets past
 *     `normalisePath` in a form the rest of the code has to think about.
 *
 *  2. **Containment** — a tree walk rooted at a directory the user chose must
 *     not read outside it. This is what `isInside` is for, and it is enforced in
 *     the engine worker, where the reads actually happen.
 *
 * What this deliberately does **not** claim: that a compromised renderer cannot
 * name an arbitrary file. It can, and no amount of checking in main changes
 * that — Electron 32 removed `File.path`, so a dropped file's path is produced
 * by `webUtils.getPathForFile` in the renderer process and asserted to main.
 * A renderer that can call `input.read` at all can therefore introduce any path
 * it likes, exactly as if the user had dropped that file. Containment bounds
 * what happens *after* a root is chosen; it cannot bound the choosing.
 *
 * Lives in `shared/` because the engine worker needs it too, and the worker must
 * not import from `main/`. It has no runtime dependency beyond `node:path`, so
 * it never reaches the sandboxed preload's bundle (the preload does not import
 * it — see the note on `channels.ts`).
 */

/** Rejects what is not a usable absolute path, and canonicalises what is. */
export function normalisePath(raw: string): string {
  // A NUL truncates the string inside libuv, so "/tmp/ok\0/../../etc/passwd"
  // would be validated as one path and opened as another.
  if (raw.includes('\0')) {
    throw new Error('That path contains a null byte and cannot be opened.');
  }
  if (raw.trim() === '') {
    throw new Error('That path is empty.');
  }
  if (!isAbsolute(raw)) {
    throw new Error('Only absolute paths can be opened.');
  }
  // `resolve` collapses `.`, `..` and duplicate separators, so nothing
  // downstream has to reason about traversal.
  return resolve(raw);
}

/**
 * Is `target` the root itself, or somewhere beneath it?
 *
 * The `sep` matters: without it `/home/user-secrets` counts as inside
 * `/home/user`, which is the classic prefix-matching bug.
 */
export function isInside(root: string, target: string): boolean {
  const base = resolve(root);
  const path = resolve(target);
  return path === base || path.startsWith(base.endsWith(sep) ? base : base + sep);
}
