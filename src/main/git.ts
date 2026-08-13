import { assertSafeRef, WORKTREE } from '../engines/git';
import { git } from '../shared/gitCli';
import { isInside } from '../shared/paths';

/**
 * The renderer's read-only window onto a git repository (v0.2.1).
 *
 * Two jobs, both of which have to happen *outside* a comparison:
 *
 *  1. **Probing.** The ref pickers need the branch and tag lists before any job
 *     starts, so the engine host — which is job-shaped — is the wrong place.
 *  2. **Blob reads.** Drilling into a changed file compares two `git show`
 *     outputs, and neither side exists on disk, so `input.read` cannot serve it.
 */

/** Enough recent commits to pick from without turning the list into a log. */
const RECENT_COMMITS = 30;
/** A blob larger than this is not something the text diff should be handed. */
const MAX_BLOB_BYTES = 20 * 1024 * 1024;

export interface GitCommitInfo {
  sha: string;
  shortSha: string;
  subject: string;
  /** Author date, ISO 8601, as git formatted it. */
  when: string;
}

export interface GitRepoInfo {
  /** The repository root, which may be above the folder the user picked. */
  root: string;
  /** Current branch, or the short SHA when HEAD is detached. */
  head: string;
  detached: boolean;
  branches: string[];
  tags: string[];
  recent: GitCommitInfo[];
  /** True when the working tree has uncommitted changes worth comparing. */
  dirty: boolean;
}

async function lines(repo: string, args: readonly string[]): Promise<string[]> {
  const output = await git(repo, args);
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

/**
 * Describes the repository containing `path`, or `null` when there is none.
 *
 * A non-repo is an answer, not a failure: the user pointed at a folder and the
 * honest response is "that is not a git repository", shown in the panel, with no
 * job started. Everything past the root lookup is best-effort — a fresh `git
 * init` with no commits has no HEAD, and that must still probe successfully so
 * the panel can say what is missing.
 */
export async function probeRepo(path: string): Promise<GitRepoInfo | null> {
  let root: string;
  try {
    root = (await git(path, ['rev-parse', '--show-toplevel'])).trim();
  } catch {
    return null;
  }
  if (root === '') return null;

  const [head, branches, tags, recent, dirty] = await Promise.all([
    readHead(root),
    lines(root, ['branch', '--format=%(refname:short)', '--all']).catch(() => []),
    lines(root, ['tag', '--sort=-creatordate']).catch(() => []),
    readRecent(root),
    isDirty(root),
  ]);

  return {
    root,
    head: head.name,
    detached: head.detached,
    // Remote-tracking duplicates of local branches only pad the list; the local
    // name is what a user means when they type `main`.
    branches: dedupe(branches.filter((name) => !name.startsWith('remotes/'))),
    tags: dedupe(tags),
    recent,
    dirty,
  };
}

async function readHead(root: string): Promise<{ name: string; detached: boolean }> {
  try {
    const symbolic = (await git(root, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
    if (symbolic !== '' && symbolic !== 'HEAD') return { name: symbolic, detached: false };
    const sha = (await git(root, ['rev-parse', '--short', 'HEAD'])).trim();
    return { name: sha, detached: true };
  } catch {
    // No commits yet: `rev-parse HEAD` fails on an empty repository.
    return { name: '', detached: false };
  }
}

/**
 * Field and record separators for `git log --format`.
 *
 * A commit subject can contain a tab, a pipe, or several newlines, so any
 * printable delimiter is one commit message away from breaking the parse. These
 * two cannot appear in a subject at all.
 */
const UNIT = '\u001f';
const RECORD = '\u001e';

async function readRecent(root: string): Promise<GitCommitInfo[]> {
  try {
    const output = await git(root, [
      'log',
      `--max-count=${RECENT_COMMITS}`,
      `--format=%H${UNIT}%h${UNIT}%aI${UNIT}%s${RECORD}`,
    ]);
    return output
      .split(RECORD)
      .map((record) => record.replace(/^\n/, ''))
      .filter((record) => record.trim() !== '')
      .map((record) => {
        const [sha = '', shortSha = '', when = '', subject = ''] = record.split(UNIT);
        return { sha, shortSha, when, subject };
      })
      .filter((commit) => commit.sha !== '');
  } catch {
    return [];
  }
}

async function isDirty(root: string): Promise<boolean> {
  try {
    return (await git(root, ['status', '--porcelain'])).trim() !== '';
  } catch {
    return false;
  }
}

function dedupe(values: readonly string[]): string[] {
  return [...new Set(values)];
}

export interface BlobRequest {
  repo: string;
  ref: string;
  path: string;
}

/**
 * One file's content at one ref, or `null` when it does not exist there.
 *
 * `null` is the normal case for half of a drill-in: an added file has no BEFORE,
 * and the text engine compares it against the empty string.
 *
 * The path is a *repository-relative* pathspec, not a filesystem path, so it does
 * not go through `PathSchema` — it goes through the checks below instead. The
 * `./` prefix on the `git show` argument is what stops a path such as `-x` or
 * `HEAD` from being read as anything but a path.
 */
export async function readBlob(request: BlobRequest): Promise<string | null> {
  const { repo, ref, path } = request;
  assertSafeRef(ref);
  assertRepoRelative(path);

  // The working tree is not a ref: read the file from disk, within the repo.
  if (ref === WORKTREE) {
    const { readFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const absolute = join(repo, path);
    if (!isInside(repo, absolute)) return null;
    try {
      const bytes = await readFile(absolute);
      if (bytes.byteLength > MAX_BLOB_BYTES) {
        throw new Error(`${path} is too large to open here.`);
      }
      const { decodeText } = await import('../engines/encoding');
      return decodeText(new Uint8Array(bytes)).text;
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw cause;
    }
  }

  try {
    const text = await git(repo, ['show', `${ref}:./${path}`]);
    if (text.length > MAX_BLOB_BYTES) throw new Error(`${path} is too large to open here.`);
    return text;
  } catch (cause) {
    // "does not exist in" / "exists on disk, but not in" — the file simply is
    // not present at that ref, which is what one side of a drill-in looks like.
    const message = cause instanceof Error ? cause.message : String(cause);
    if (/does not exist|exists on disk|unknown revision|path .* does not exist/i.test(message)) {
      return null;
    }
    throw cause;
  }
}

/**
 * A pathspec has to stay a pathspec.
 *
 * `git show <ref>:<path>` interprets its argument, so a leading `-` or an
 * absolute path is worth refusing outright rather than relying on the `./`
 * prefix alone; `..` is refused because the pathspec must not climb out of the
 * repository.
 */
function assertRepoRelative(path: string): void {
  const bad =
    path === '' ||
    path.length > 4096 ||
    path.startsWith('-') ||
    path.startsWith('/') ||
    path.includes('\0') ||
    path.split('/').includes('..');
  if (bad) throw new Error(`"${path.slice(0, 64)}" is not a path inside this repository.`);
}
