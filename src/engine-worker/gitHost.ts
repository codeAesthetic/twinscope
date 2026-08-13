import { realpath } from 'node:fs/promises';
import { git } from '../shared/gitCli';
import { isInside, normalisePath } from '../shared/paths';
import type { GitHost } from '../engines/types';

/**
 * `GitHost` for the engine worker — the git equivalent of `hostFs.ts`.
 *
 * Engines never spawn a process any more than they open a file: they get this
 * through `EngineCtx.git`, which is what lets the same engine run in the CLI
 * (v0.2.2) and against a stub in tests.
 */
export const nodeGitHost: GitHost = {
  run: (repo, args) => git(normalisePath(repo), args),
};

/**
 * The same host, confined to one repository (plan §3.7 item 5).
 *
 * A comparison names its repo once; every command it then runs must run *there*.
 * Compared on the real path for the same reason `scopedHostFs` does: on macOS
 * `/var` is a symlink to `/private/var`, so comparing one resolved path against
 * one unresolved refuses every legitimate read under a temp directory.
 */
export function scopedGitHost(base: GitHost, root: string): GitHost {
  const declared = normalisePath(root);
  let resolved: Promise<string> | undefined;

  const realRoot = (): Promise<string> => {
    resolved ??= realpath(declared).catch(() => declared);
    return resolved;
  };

  return {
    run: async (repo, args) => {
      const path = normalisePath(repo);
      const real = await realpath(path).catch(() => path);
      const allowed = await realRoot();
      if (!isInside(allowed, real)) {
        throw new Error(`Refusing to run git outside the compared repository: ${repo}`);
      }
      return base.run(path, args);
    },
  };
}
