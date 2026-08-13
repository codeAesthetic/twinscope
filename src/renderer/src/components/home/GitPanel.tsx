import { useState } from 'react';
import { Button, Chip } from '../primitives';
import { useRunComparison } from '../../lib/compareClient';
import { useCompareStore } from '../../stores/compare';
import { WORKTREE } from '../../../../engines/git';
import type { GitRepoInfo } from '../../../../shared/channels';

/**
 * Git ref intake (v0.2.1, MD §19).
 *
 * Two refs in one repository become two inputs of `kind: 'git'`, and from there
 * the pair travels the same road as every other comparison — `setInput`, the job
 * pipeline, the engine host. Nothing downstream knows a git panel exists, which
 * is the same property intake has had since MVP-2.
 *
 * The ref inputs are free text with a `datalist`, not a `select`: a commit id is
 * a legitimate answer and no list can contain them all. Validation is the
 * engine's (`isSafeRef`), enforced again in main, so a typo produces a real error
 * rather than a silently different comparison.
 */
export function GitPanel({ onClose }: { onClose: () => void }) {
  const [repo, setRepo] = useState<GitRepoInfo | null>(null);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [before, setBefore] = useState('');
  const [after, setAfter] = useState('');

  const setInput = useCompareStore((state) => state.setInput);
  const runComparison = useRunComparison();

  const pick = async (): Promise<void> => {
    setPicking(true);
    setError(null);
    try {
      // The folder picker already returns a validated, normalised path — there is
      // no reason for a second channel that opens the same dialog.
      const chosen = await window.twinscope.dialog.pickFolder('A');
      if (chosen?.path === undefined) return;

      const info = await window.twinscope.git.probe(chosen.path);
      if (info === null) {
        setRepo(null);
        setError(`${chosen.name} is not a git repository.`);
        return;
      }
      if (info.head === '') {
        setRepo(null);
        setError(`${chosen.name} is a git repository with no commits yet.`);
        return;
      }

      setRepo(info);
      // The useful default, and the reason most people open this panel: what have
      // I changed since the last commit?
      setBefore(info.head);
      setAfter(info.dirty ? WORKTREE : info.head);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPicking(false);
    }
  };

  const compare = async (): Promise<void> => {
    if (repo === null) return;
    const sideFor = (side: 'A' | 'B', ref: string) => ({
      side,
      kind: 'git' as const,
      name: `${baseName(repo.root)} @ ${ref === WORKTREE ? 'working tree' : ref}`,
      path: repo.root,
      size: 0,
      ref,
    });

    setInput('A', sideFor('A', before));
    setInput('B', sideFor('B', after));
    // No engine id: two `git` inputs detect to the git engine, and Rule 1 says
    // never name an engine we can work out.
    await runComparison();
  };

  const options = repo === null ? [] : refOptions(repo);
  const ready = repo !== null && before !== '' && after !== '' && before !== after;

  return (
    <section className="dd-gitpanel" data-testid="git-panel" aria-label="Compare git refs">
      <div className="dd-gitpanel-head">
        <h2>Compare git refs</h2>
        {repo !== null && repo.dirty && <Chip variant="mod">uncommitted changes</Chip>}
        {repo !== null && repo.detached && <Chip variant="info">detached HEAD</Chip>}
        <Button variant="ghost" size="sm" data-testid="git-close" onClick={onClose}>
          Close
        </Button>
      </div>

      <div className="dd-gitrefs">
        <Button
          data-testid="git-pick-repo"
          disabled={picking}
          onClick={() => {
            void pick();
          }}
        >
          {repo === null ? 'Choose repository…' : 'Change repository…'}
        </Button>

        {repo !== null && (
          <>
            <label className="dd-gitfield">
              <span>Before</span>
              <input
                data-testid="git-ref-before"
                list="dd-git-refs"
                value={before}
                spellCheck={false}
                autoComplete="off"
                onChange={(event) => setBefore(event.target.value)}
              />
            </label>

            <label className="dd-gitfield">
              <span>After</span>
              <input
                data-testid="git-ref-after"
                list="dd-git-refs"
                value={after}
                spellCheck={false}
                autoComplete="off"
                onChange={(event) => setAfter(event.target.value)}
              />
            </label>

            {/* One list serves both fields. `WORKTREE` is offered as a value
                because it is a real thing to compare against, and it is the only
                entry that is not a ref git would recognise. */}
            <datalist id="dd-git-refs">
              {options.map((option) => (
                <option key={option.value} value={option.value} label={option.label} />
              ))}
            </datalist>

            <Button
              variant="primary"
              data-testid="git-compare"
              disabled={!ready}
              onClick={() => {
                void compare();
              }}
            >
              Compare refs
            </Button>
          </>
        )}
      </div>

      {repo !== null && (
        <p className="dd-gitrepo" data-testid="git-repo-root">
          {repo.root}
        </p>
      )}

      {error !== null && (
        <p className="dd-gitnote" data-tone="error" role="alert" data-testid="git-error">
          {error}
        </p>
      )}

      {repo === null && error === null && (
        <p className="dd-gitnote">
          Pick a repository, then choose two refs — a branch, a tag, a commit id, or the working
          tree.
        </p>
      )}

      {ready === false && repo !== null && before === after && (
        <p className="dd-gitnote" data-testid="git-same-ref">
          Both sides are {before === WORKTREE ? 'the working tree' : before} — pick two different
          refs.
        </p>
      )}
    </section>
  );
}

interface RefOption {
  value: string;
  label: string;
}

/**
 * The working tree first, then branches, tags and recent commits.
 *
 * The working tree leads because it is what the panel is opened for most often,
 * and it is offered whether or not the tree is currently dirty — "nothing has
 * changed since HEAD" is a legitimate comparison to want confirmed.
 */
function refOptions(repo: GitRepoInfo): RefOption[] {
  const options: RefOption[] = [{ value: WORKTREE, label: 'working tree (uncommitted)' }];
  for (const branch of repo.branches) options.push({ value: branch, label: `branch ${branch}` });
  for (const tag of repo.tags) options.push({ value: tag, label: `tag ${tag}` });
  for (const commit of repo.recent) {
    options.push({ value: commit.shortSha, label: `${commit.shortSha} ${commit.subject}` });
  }
  return options;
}

function baseName(path: string): string {
  const parts = path.split('/').filter((part) => part !== '');
  return parts[parts.length - 1] ?? path;
}
