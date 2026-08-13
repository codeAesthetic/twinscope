import { describe, expect, it, vi } from 'vitest';
import {
  buildRows,
  diffArgs,
  diffRefs,
  isInverted,
  parseNameStatus,
  parseNumStat,
  summarise,
  DEFAULT_GIT_OPTIONS,
  MAX_FILES,
} from './gitDiff';
import { assertSafeRef, isSafeRef, refLabel, WORKTREE } from './refs';
import { gitEngine } from './index';
import type { EngineCtx, GitHost, InputRef } from '../types';

/** `-z` output is NUL-*terminated*, so every record ends with one. */
const z = (...parts: string[]): string => parts.map((part) => `${part}\0`).join('');

describe('ref validation', () => {
  it('accepts the ref shapes the UI can produce', () => {
    for (const ref of [
      'main',
      'HEAD',
      'HEAD~3',
      'HEAD^',
      'v1.2.0',
      'refs/heads/feature/thing',
      'origin/main',
      '9f2c1ab',
      'a'.repeat(40),
      WORKTREE,
    ]) {
      expect(isSafeRef(ref), ref).toBe(true);
    }
  });

  it('rejects argument injection, which is the actual risk here', () => {
    // A ref reaches git as argv, so quoting is irrelevant — but an argument that
    // starts with a dash is read as an option, and `--upload-pack` runs a program.
    expect(isSafeRef('--upload-pack=/bin/sh')).toBe(false);
    expect(isSafeRef('-M')).toBe(false);
  });

  it('rejects range syntax, so two refs cannot become one range', () => {
    expect(isSafeRef('main..dev')).toBe(false);
    expect(isSafeRef('main...dev')).toBe(false);
  });

  it('rejects a colon, so a ref cannot become a ref:path pathspec', () => {
    expect(isSafeRef('main:package.json')).toBe(false);
  });

  it('rejects whitespace, globs and control characters', () => {
    for (const ref of ['main dev', 'main\ndev', 'ma*n', 'main?', 'main\0', '', ' ']) {
      expect(isSafeRef(ref), JSON.stringify(ref)).toBe(false);
    }
  });

  it('rejects the forms git itself refuses', () => {
    expect(isSafeRef('main.lock')).toBe(false);
    expect(isSafeRef('main/')).toBe(false);
    expect(isSafeRef('main.')).toBe(false);
    expect(isSafeRef('a'.repeat(256))).toBe(false);
  });

  it('throws a message worth showing a user', () => {
    expect(() => assertSafeRef('--exec=x')).toThrow(/not a usable git ref/);
  });

  it('labels the working-tree sentinel as something a human said', () => {
    expect(refLabel(WORKTREE)).toBe('working tree');
    expect(refLabel('main')).toBe('main');
  });
});

describe('diffArgs', () => {
  it('puts BEFORE then AFTER, git’s own order', () => {
    expect(diffArgs('--name-status', 'main', 'dev', DEFAULT_GIT_OPTIONS)).toEqual([
      'diff',
      '--name-status',
      '-z',
      '--no-color',
      '--find-renames=50%',
      'main',
      'dev',
      '--',
    ]);
  });

  it('omits the second ref for a working-tree comparison', () => {
    // `git diff <ref>` means "that ref against the files on disk". There is no
    // ref name for the working tree, so it is expressed by absence.
    expect(diffArgs('--numstat', 'main', WORKTREE, DEFAULT_GIT_OPTIONS)).toEqual([
      'diff',
      '--numstat',
      '-z',
      '--no-color',
      '--find-renames=50%',
      'main',
      '--',
    ]);
  });

  it('omits the first ref just as happily, and isInverted flags it', () => {
    expect(diffArgs('--numstat', WORKTREE, 'main', DEFAULT_GIT_OPTIONS)).toContain('main');
    expect(isInverted(WORKTREE, 'main')).toBe(true);
    expect(isInverted('main', WORKTREE)).toBe(false);
    expect(isInverted('main', 'dev')).toBe(false);
  });

  it('clamps the rename threshold and can turn renames off', () => {
    expect(
      diffArgs('--name-status', 'a', 'b', { ...DEFAULT_GIT_OPTIONS, renameThreshold: 900 }),
    ).toContain('--find-renames=100%');
    expect(
      diffArgs('--name-status', 'a', 'b', { ...DEFAULT_GIT_OPTIONS, renameThreshold: 1 }),
    ).toContain('--find-renames=10%');
    expect(
      diffArgs('--name-status', 'a', 'b', { ...DEFAULT_GIT_OPTIONS, detectRenames: false }),
    ).toContain('--no-renames');
  });

  it('passes whitespace insensitivity through', () => {
    expect(
      diffArgs('--numstat', 'a', 'b', { ...DEFAULT_GIT_OPTIONS, ignoreWhitespace: true }),
    ).toContain('--ignore-all-space');
  });

  it('refuses an unsafe ref before a process is ever spawned', () => {
    expect(() => diffArgs('--numstat', 'main', '--upload-pack=x', DEFAULT_GIT_OPTIONS)).toThrow();
  });
});

describe('parseNameStatus', () => {
  it('reads the two-field records', () => {
    expect(parseNameStatus(z('A', 'new.ts', 'D', 'gone.ts', 'M', 'edit.ts'))).toEqual([
      { status: 'add', path: 'new.ts' },
      { status: 'del', path: 'gone.ts' },
      { status: 'mod', path: 'edit.ts' },
    ]);
  });

  it('reads a rename as THREE fields, not two', () => {
    // The bug this guards: treating every record as a pair makes the old path a
    // row of its own and shifts every later record by one.
    const parsed = parseNameStatus(z('R096', 'old.ts', 'new.ts', 'M', 'after.ts'));
    expect(parsed).toEqual([
      { status: 'rename', path: 'new.ts', oldPath: 'old.ts', score: 96 },
      { status: 'mod', path: 'after.ts' },
    ]);
  });

  it('reads a copy the same way', () => {
    expect(parseNameStatus(z('C100', 'src.ts', 'copy.ts'))).toEqual([
      { status: 'copy', path: 'copy.ts', oldPath: 'src.ts', score: 100 },
    ]);
  });

  it('survives a path containing a newline, which is why -z exists', () => {
    expect(parseNameStatus(z('M', 'weird\nname.ts'))).toEqual([
      { status: 'mod', path: 'weird\nname.ts' },
    ]);
  });

  it('maps type changes and unmerged paths rather than dropping them', () => {
    expect(parseNameStatus(z('T', 'link.ts', 'U', 'conflict.ts'))).toEqual([
      { status: 'type', path: 'link.ts' },
      { status: 'unmerged', path: 'conflict.ts' },
    ]);
  });

  it('ignores a truncated trailing record instead of inventing a path', () => {
    expect(parseNameStatus(z('M', 'a.ts', 'R100', 'only-old.ts'))).toEqual([
      { status: 'mod', path: 'a.ts' },
    ]);
  });

  it('returns nothing for empty output', () => {
    expect(parseNameStatus('')).toEqual([]);
  });
});

describe('parseNumStat', () => {
  it('keys counts by path', () => {
    const counts = parseNumStat(z('3\t1\tedit.ts', '10\t0\tnew.ts'));
    expect(counts.get('edit.ts')).toEqual({ path: 'edit.ts', added: 3, removed: 1, binary: false });
    expect(counts.get('new.ts')?.added).toBe(10);
  });

  it('reads the rename form, where the path field is empty', () => {
    // `3\t1\t\0old\0new\0` — the two paths are their own fields.
    const counts = parseNumStat(z('3\t1\t', 'old.ts', 'new.ts'));
    expect([...counts.keys()]).toEqual(['new.ts']);
    expect(counts.get('new.ts')).toEqual({ path: 'new.ts', added: 3, removed: 1, binary: false });
  });

  it('treats git’s dashes as binary rather than as zero', () => {
    const counts = parseNumStat(z('-\t-\tlogo.png'));
    expect(counts.get('logo.png')).toEqual({
      path: 'logo.png',
      added: 0,
      removed: 0,
      binary: true,
    });
  });

  it('skips a record with no tabs instead of throwing', () => {
    expect(parseNumStat(z('nonsense')).size).toBe(0);
  });
});

describe('buildRows', () => {
  const nameStatus = z('A', 'b.ts', 'D', 'a.ts', 'R100', 'old.ts', 'new.ts');
  const numStat = z('5\t0\tb.ts', '0\t7\ta.ts', '0\t0\t', 'old.ts', 'new.ts');

  it('pairs statuses with counts and sorts by path', () => {
    const { rows, partial } = buildRows(nameStatus, numStat, false);
    expect(partial).toBe(false);
    expect(rows.map((row) => row.path)).toEqual(['a.ts', 'b.ts', 'new.ts']);
    expect(rows[1]).toMatchObject({ path: 'b.ts', status: 'add', added: 5, removed: 0 });
    expect(rows[2]).toMatchObject({ status: 'rename', oldPath: 'old.ts', score: 100 });
  });

  it('inverts statuses and line counts when the working tree is the BEFORE side', () => {
    const { rows } = buildRows(nameStatus, numStat, true);
    const byPath = new Map(rows.map((row) => [row.path, row]));
    // git was asked the other way round, so its A is our deletion.
    expect(byPath.get('b.ts')?.status).toBe('del');
    expect(byPath.get('a.ts')?.status).toBe('add');
    // And the side that gained lines swaps with it.
    expect(byPath.get('b.ts')).toMatchObject({ added: 0, removed: 5 });
    expect(byPath.get('a.ts')).toMatchObject({ added: 7, removed: 0 });
    // A rename is a rename in either direction.
    expect(byPath.get('new.ts')?.status).toBe('rename');
  });

  it('zero-fills a path numstat did not mention', () => {
    const { rows } = buildRows(z('M', 'only.ts'), '', false);
    expect(rows[0]).toMatchObject({ path: 'only.ts', added: 0, removed: 0, binary: false });
  });

  it('caps a huge change set and says so', () => {
    const many = Array.from({ length: MAX_FILES + 5 }, (_, index) => ['M', `f${index}.ts`]).flat();
    const { rows, partial } = buildRows(z(...many), '', false);
    expect(rows).toHaveLength(MAX_FILES);
    expect(partial).toBe(true);
  });
});

describe('summarise', () => {
  it('counts files, not lines, and folds a rename into modified', () => {
    const stats = summarise([
      { path: 'a', status: 'add', added: 1, removed: 0, binary: false },
      { path: 'b', status: 'del', added: 0, removed: 2, binary: false },
      { path: 'c', status: 'mod', added: 1, removed: 1, binary: false },
      { path: 'd', status: 'rename', added: 0, removed: 0, binary: false },
      { path: 'e', status: 'copy', added: 3, removed: 0, binary: false },
      { path: 'f', status: 'type', added: 0, removed: 0, binary: false },
      { path: 'g', status: 'mod', added: 0, removed: 0, binary: true },
    ]);
    expect(stats).toEqual({
      added: 2,
      removed: 1,
      // mod + rename + type + the binary mod. A rename counts in both columns on
      // purpose: it is one changed file, and `renamed` explains how.
      modified: 4,
      renamed: 1,
      copied: 1,
      binary: 1,
    });
  });
});

describe('the git engine', () => {
  const ctxFor = (git: GitHost): EngineCtx => ({
    signal: new AbortController().signal,
    progress: () => undefined,
    git,
  });

  const refFor = (side: 'A' | 'B', ref: string, path = '/repo'): InputRef => ({
    side,
    kind: 'git',
    name: `repo @ ${ref}`,
    path,
    size: 0,
    ref,
  });

  it('claims a git pair and nothing else', () => {
    expect(gitEngine.canHandle(refFor('A', 'main'), refFor('B', 'dev'))).toBe(true);
    expect(
      gitEngine.canHandle({ side: 'A', kind: 'text', name: 'a', size: 0 }, refFor('B', 'dev')),
    ).toBe(false);
  });

  it('runs both commands and reports a summary', async () => {
    const run = vi
      .fn<GitHost['run']>()
      .mockImplementation((_repo, args) =>
        Promise.resolve(
          args.includes('--name-status')
            ? z('A', 'new.ts', 'M', 'edit.ts')
            : z('4\t0\tnew.ts', '2\t3\tedit.ts'),
        ),
      );

    const result = await gitEngine.compare(
      refFor('A', 'main'),
      refFor('B', 'dev'),
      gitEngine.defaultOptions(),
      ctxFor({ run }),
    );

    expect(result.engineId).toBe('git');
    expect(result.summary).toMatchObject({ added: 1, removed: 0, modified: 1 });
    expect(result.summary.extra?.lines).toBe('＋6 －3');
    expect(result.data.rows.map((row) => row.path)).toEqual(['edit.ts', 'new.ts']);
    expect(result.data.before.label).toBe('main');
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('explains its rename setting, because normalisation must be visible', () => {
    // Rule 3: anything that changes the counts says so.
    return expect(
      gitEngine
        .compare(
          refFor('A', 'main'),
          refFor('B', WORKTREE),
          { ...DEFAULT_GIT_OPTIONS, ignoreWhitespace: true },
          ctxFor({ run: () => Promise.resolve('') }),
        )
        .then((result) => result.normalizationNotes),
    ).resolves.toEqual([
      'Renames detected by git at 50% similarity.',
      'Whitespace-only changes were ignored, so some files may be absent entirely.',
    ]);
  });

  it('refuses the pairs it cannot answer', async () => {
    const ctx = ctxFor({ run: () => Promise.resolve('') });

    await expect(
      gitEngine.compare(
        refFor('A', 'main', '/one'),
        refFor('B', 'dev', '/two'),
        DEFAULT_GIT_OPTIONS,
        ctx,
      ),
    ).rejects.toThrow(/same repository/);

    await expect(
      gitEngine.compare(refFor('A', WORKTREE), refFor('B', WORKTREE), DEFAULT_GIT_OPTIONS, ctx),
    ).rejects.toThrow(/against itself/);

    await expect(
      gitEngine.compare(
        { side: 'A', kind: 'git', name: 'repo', size: 0, ref: 'main' },
        refFor('B', 'dev'),
        DEFAULT_GIT_OPTIONS,
        ctx,
      ),
    ).rejects.toThrow(/repository on disk/);
  });

  it('needs a git host, and says so rather than crashing', async () => {
    await expect(
      gitEngine.compare(refFor('A', 'main'), refFor('B', 'dev'), DEFAULT_GIT_OPTIONS, {
        signal: new AbortController().signal,
        progress: () => undefined,
      }),
    ).rejects.toThrow(/No git access/);
  });

  it('includes untracked files, which `git diff` alone never reports', async () => {
    // The bug this guards is silent and severe: a working-tree comparison that
    // misses the file you just created reads as "no changes".
    const run = vi.fn<GitHost['run']>().mockImplementation((_repo, args) => {
      if (args[0] === 'ls-files') return Promise.resolve(z('brand-new.ts', 'docs/also-new.md'));
      if (args.includes('--name-status')) return Promise.resolve(z('M', 'edit.ts'));
      return Promise.resolve(z('1\t1\tedit.ts'));
    });

    const result = await gitEngine.compare(
      refFor('A', 'main'),
      refFor('B', WORKTREE),
      DEFAULT_GIT_OPTIONS,
      {
        ...ctxFor({ run }),
        fs: { readText: () => Promise.resolve('a\nb\nc\n') } as unknown as EngineCtx['fs'],
      },
    );

    expect(result.data.rows.map((row) => row.path)).toEqual([
      'brand-new.ts',
      'docs/also-new.md',
      'edit.ts',
    ]);
    expect(result.summary).toMatchObject({ added: 2, modified: 1 });
    // Three lines each, counted through HostFs — git has no record of them.
    expect(result.data.rows[0]).toMatchObject({ status: 'add', added: 3, removed: 0 });
    expect(result.normalizationNotes).toContain(
      'Included 2 untracked files — `git diff` alone does not report them.',
    );
  });

  it('reads untracked files as removals when the working tree is the BEFORE side', async () => {
    const run = vi
      .fn<GitHost['run']>()
      .mockImplementation((_repo, args) =>
        Promise.resolve(args[0] === 'ls-files' ? z('only-on-disk.ts') : ''),
      );

    const result = await gitEngine.compare(
      refFor('A', WORKTREE),
      refFor('B', 'main'),
      DEFAULT_GIT_OPTIONS,
      ctxFor({ run }),
    );

    expect(result.data.rows[0]).toMatchObject({ path: 'only-on-disk.ts', status: 'del' });
    expect(result.summary.removed).toBe(1);
  });

  it('does not ask for untracked files when neither side is the working tree', async () => {
    const run = vi.fn<GitHost['run']>().mockResolvedValue('');
    await gitEngine.compare(
      refFor('A', 'main'),
      refFor('B', 'dev'),
      DEFAULT_GIT_OPTIONS,
      ctxFor({ run }),
    );
    expect(run.mock.calls.every(([, args]) => args[0] !== 'ls-files')).toBe(true);
  });

  it('still lists an untracked file when no filesystem is available', async () => {
    const run = vi
      .fn<GitHost['run']>()
      .mockImplementation((_repo, args) =>
        Promise.resolve(args[0] === 'ls-files' ? z('new.ts') : ''),
      );
    const result = await gitEngine.compare(
      refFor('A', 'main'),
      refFor('B', WORKTREE),
      DEFAULT_GIT_OPTIONS,
      ctxFor({ run }),
    );
    // Knowing the file is new matters more than knowing how long it is.
    expect(result.data.rows[0]).toMatchObject({ path: 'new.ts', status: 'add', added: 0 });
  });

  it('honours cancellation between the two commands', async () => {
    const controller = new AbortController();
    const run = vi.fn<GitHost['run']>().mockImplementation(() => {
      controller.abort();
      return Promise.resolve('');
    });

    await expect(
      diffRefs({ run }, '/repo', 'main', 'dev', DEFAULT_GIT_OPTIONS, {
        shouldAbort: () => controller.signal.aborted,
      }),
    ).rejects.toThrow(/cancelled/i);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
