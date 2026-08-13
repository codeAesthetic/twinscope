import { execFile } from 'node:child_process';

/**
 * The one place the app spawns `git` (v0.2.1).
 *
 * Node-only, like `paths.ts`, and excluded from the renderer's tsconfig for the
 * same reason. Both main (`main/git.ts`, for the repo probe and blob reads) and
 * the engine worker (`engine-worker/gitHost.ts`, for the diff itself) import it,
 * so the process hygiene below is written once rather than twice.
 *
 * Decisions worth not rediscovering:
 *
 *  - **`execFile`, never `exec`.** No shell means no quoting rules to get wrong.
 *    The remaining risk is argument injection, which is handled by validating
 *    refs (`engines/git/refs.ts`) and by the subcommand allowlist here.
 *  - **`GIT_TERMINAL_PROMPT=0`.** A repo with an http remote and no cached
 *    credentials will otherwise sit waiting on a username prompt that has no
 *    terminal to appear on, and the job hangs until the timeout.
 *  - **`GIT_OPTIONAL_LOCKS=0`.** `git status` and friends refresh the index by
 *    default, which takes `.git/index.lock`. A comparison is a read; it has no
 *    business blocking the user's own git commands.
 *  - **A large `maxBuffer`.** `--numstat` over a release-sized commit range is
 *    megabytes of text, and the default 1 MB truncates it into a parse error
 *    that looks like a git bug.
 */

/** Every subcommand the app is allowed to run. Read-only, all of them. */
const ALLOWED = new Set(['diff', 'show', 'rev-parse', 'branch', 'tag', 'log', 'status']);

const TIMEOUT_MS = 30_000;
const MAX_BUFFER = 64 * 1024 * 1024;

export interface GitFailure extends Error {
  /** git's own exit code, when it produced one. */
  code?: number;
  stderr?: string;
}

export class GitError extends Error implements GitFailure {
  readonly code: number | undefined;
  readonly stderr: string | undefined;

  constructor(message: string, options: { code?: number; stderr?: string } = {}) {
    super(message);
    this.name = 'GitError';
    this.code = options.code;
    this.stderr = options.stderr;
  }
}

/**
 * Runs one git command in `repo` and resolves with its stdout.
 *
 * Rejects with a `GitError` carrying git's own first line of stderr — "unknown
 * revision" is a far better thing to show a user than "command failed with 128".
 */
export function git(repo: string, args: readonly string[]): Promise<string> {
  const subcommand = args[0];
  if (subcommand === undefined || !ALLOWED.has(subcommand)) {
    return Promise.reject(new GitError(`git ${String(subcommand)} is not allowed here.`));
  }

  return new Promise((resolve, reject) => {
    execFile(
      'git',
      [...args],
      {
        cwd: repo,
        timeout: TIMEOUT_MS,
        maxBuffer: MAX_BUFFER,
        windowsHide: true,
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: '0',
          GIT_OPTIONAL_LOCKS: '0',
          // Keeps a user's `core.pager`/`color.ui` out of machine-read output.
          GIT_PAGER: 'cat',
        },
      },
      (cause, stdout, stderr) => {
        if (cause === null) {
          resolve(stdout);
          return;
        }

        const withCode = cause as NodeJS.ErrnoException & { code?: number | string };
        if (withCode.code === 'ENOENT') {
          reject(
            new GitError(
              'git was not found on this system. Install git, or add it to your PATH, to compare refs.',
            ),
          );
          return;
        }

        const firstLine = String(stderr)
          .split('\n')
          .find((line) => line.trim() !== '');
        reject(
          new GitError(firstLine ?? cause.message, {
            ...(typeof withCode.code === 'number' ? { code: withCode.code } : {}),
            stderr: String(stderr),
          }),
        );
      },
    );
  });
}
