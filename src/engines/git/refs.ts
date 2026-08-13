/**
 * Git ref validation (v0.2.1).
 *
 * A ref reaches `git` as an argv element, never through a shell, so quoting is
 * not the risk here — **argument injection** is. `git diff --upload-pack=/bin/sh`
 * is a valid command line, and `A..B` turns two refs into a range. So the rule is
 * an allowlist, not an escape:
 *
 *  - must start with a letter or digit, which kills every `-`-prefixed option;
 *  - `..` is rejected, which kills range and `...` merge-base syntax;
 *  - `:` is rejected, which keeps a ref from becoming a `ref:path` pathspec;
 *  - control characters, spaces and glob characters are simply not in the set.
 *
 * `HEAD~3`, `v1.2.0`, `refs/heads/feature/x`, `origin/main` and a full SHA all
 * pass. `@{upstream}` does not, deliberately: nothing in the UI offers it and
 * `{}` would widen the set for one convenience.
 *
 * This lives in `engines/` rather than in main so the guard travels with the
 * engine — the CLI (v0.2.2) gets it for free, and it is enforced twice on the
 * desktop path (zod at the IPC boundary, then again here).
 */

/** The sentinel ref meaning "the files as they are on disk right now". */
export const WORKTREE = 'WORKTREE';

const SAFE_REF = /^[A-Za-z0-9][A-Za-z0-9._/^~-]*$/;

/** The longest ref git itself will accept comfortably; also a DoS bound. */
const MAX_REF_LENGTH = 255;

export function isSafeRef(ref: string): boolean {
  if (ref === WORKTREE) return true;
  if (ref.length === 0 || ref.length > MAX_REF_LENGTH) return false;
  if (ref.includes('..')) return false;
  if (ref.endsWith('.lock')) return false;
  if (ref.endsWith('/') || ref.endsWith('.')) return false;
  return SAFE_REF.test(ref);
}

/** Throws with a message safe to show a user. Used at every entry point. */
export function assertSafeRef(ref: string): string {
  if (!isSafeRef(ref)) {
    throw new Error(
      `"${ref.slice(0, 64)}" is not a usable git ref. Use a branch, tag, or commit id.`,
    );
  }
  return ref;
}

/** How a ref reads in the UI. The sentinel is not a name anyone typed. */
export function refLabel(ref: string): string {
  return ref === WORKTREE ? 'working tree' : ref;
}
