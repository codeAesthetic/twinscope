import { mkdtemp, mkdir, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterAll, describe, expect, it } from 'vitest';
import { DEFAULT_FOLDER_OPTIONS, diffFolders, type FolderDiffOptions } from './folderDiff';
import { folderEngine } from './index';
import { nodeHostFs } from '../../engine-worker/hostFs';
import type { EngineCtx, InputRef } from '../types';

/**
 * These run against the real filesystem through the real `nodeHostFs`, because
 * the parts most likely to break — symlinks, permissions, mtime resolution —
 * are exactly the ones a fake would get politely wrong.
 */

const roots: string[] = [];

async function tree(spec: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'twinscope-folder-'));
  roots.push(root);

  for (const [path, content] of Object.entries(spec)) {
    const full = join(root, path);
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, content);
    // A fixed mtime keeps "same size, same time" deterministic across runs.
    await utimes(full, new Date(1_700_000_000_000), new Date(1_700_000_000_000));
  }

  return root;
}

afterAll(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

const options = (patch: Partial<FolderDiffOptions> = {}): FolderDiffOptions => ({
  ...DEFAULT_FOLDER_OPTIONS,
  ...patch,
});

describe('diffFolders', () => {
  it('classifies added, removed, modified and identical files', async () => {
    const before = await tree({
      'src/keep.ts': 'same',
      'src/edit.ts': 'one',
      'src/gone.ts': 'bye',
    });
    const after = await tree({
      'src/keep.ts': 'same',
      'src/edit.ts': 'one plus more',
      'src/new.ts': 'hi',
    });

    const { stats, data } = await diffFolders(nodeHostFs, before, after, options());

    expect(stats.added).toBe(1);
    expect(stats.removed).toBe(1);
    expect(stats.modified).toBe(1);
    expect(stats.identical).toBe(1);

    const byPath = new Map(data.rows.map((row) => [row.path, row]));
    expect(byPath.get('src/new.ts')?.status).toBe('add');
    expect(byPath.get('src/gone.ts')?.status).toBe('del');
    expect(byPath.get('src/edit.ts')?.status).toBe('mod');
    expect(byPath.get('src/keep.ts')?.status).toBe('same');
  });

  it('marks the absent side so a row reads as a gap, not an empty file', async () => {
    const before = await tree({ 'only-a.txt': 'x' });
    const after = await tree({ 'only-b.txt': 'y' });

    const { data } = await diffFolders(nodeHostFs, before, after, options());
    const added = data.rows.find((row) => row.path === 'only-b.txt');

    expect(added?.left.status).toBe('nil');
    expect(added?.right.status).toBe('add');
  });

  it('rolls a change up to the containing directory', async () => {
    const before = await tree({ 'deep/nested/file.ts': 'a' });
    const after = await tree({ 'deep/nested/file.ts': 'a changed' });

    const { data } = await diffFolders(nodeHostFs, before, after, options());
    const byPath = new Map(data.rows.map((row) => [row.path, row]));

    expect(byPath.get('deep')?.status).toBe('mod');
    expect(byPath.get('deep/nested')?.status).toBe('mod');
  });

  it('hashes only when size matches but the timestamp does not', async () => {
    const before = await tree({ 'a.txt': 'hello' });
    const after = await tree({ 'a.txt': 'hello' });
    await utimes(join(after, 'a.txt'), new Date(), new Date());

    let hashes = 0;
    const counting = {
      ...nodeHostFs,
      hashFile: async (path: string) => {
        hashes += 1;
        return nodeHostFs.hashFile(path);
      },
    };

    const { stats, notes } = await diffFolders(counting, before, after, options());
    expect(hashes).toBe(2);
    expect(stats.identical).toBe(1);
    expect(stats.modified).toBe(0);
    expect(notes.join(' ')).toContain('Hashed 1 file');
  });

  it('trusts size and mtime alone when hashing is off', async () => {
    const before = await tree({ 'a.txt': 'hello' });
    const after = await tree({ 'a.txt': 'HELLO' });
    await utimes(join(after, 'a.txt'), new Date(), new Date());

    const { stats, notes } = await diffFolders(
      nodeHostFs,
      before,
      after,
      options({ compareContentHash: false }),
    );
    // Same size, and the user opted out of reading content — so it says so
    // rather than pretending it checked.
    expect(stats.identical).toBe(1);
    expect(notes.join(' ')).toContain('content was not hashed');
  });

  it('pairs a rename inside one folder', async () => {
    const before = await tree({ 'ui/OldModal.tsx': 'body-of-the-modal' });
    const after = await tree({ 'ui/Modal.tsx': 'body-of-the-modal' });

    const { stats, data } = await diffFolders(nodeHostFs, before, after, options());
    expect(stats.renames).toBe(1);
    expect(data.rows.find((row) => row.path === 'ui/Modal.tsx')?.note).toBe(
      'renamed from OldModal.tsx',
    );
  });

  it('leaves renames unpaired when the option is off', async () => {
    const before = await tree({ 'ui/OldModal.tsx': 'same-bytes' });
    const after = await tree({ 'ui/Modal.tsx': 'same-bytes' });

    const { stats } = await diffFolders(
      nodeHostFs,
      before,
      after,
      options({ detectRenames: false }),
    );
    expect(stats.renames).toBe(0);
  });

  it('skips ignored directories entirely', async () => {
    const before = await tree({ 'src/a.ts': 'a', 'node_modules/dep/index.js': 'huge' });
    const after = await tree({ 'src/a.ts': 'a' });

    const { data, stats } = await diffFolders(nodeHostFs, before, after, options());
    expect(data.rows.some((row) => row.path.startsWith('node_modules'))).toBe(false);
    expect(stats.removed).toBe(0);
  });

  it('counts symlinks instead of following them', async () => {
    const before = await tree({ 'real.txt': 'x' });
    const after = await tree({ 'real.txt': 'x' });
    await symlink(join(after, 'real.txt'), join(after, 'link.txt'));

    const { notes, data } = await diffFolders(nodeHostFs, before, after, options());
    expect(notes.join(' ')).toContain('1 symlink');
    expect(data.rows.some((row) => row.path === 'link.txt')).toBe(false);
  });

  it('orders directories before files at each level', async () => {
    const before = await tree({ 'zzz/inner.ts': 'a', 'aaa.ts': 'b' });
    const after = await tree({ 'zzz/inner.ts': 'a', 'aaa.ts': 'b' });

    const { data } = await diffFolders(nodeHostFs, before, after, options());
    expect(data.rows.map((row) => row.path)).toEqual(['zzz', 'zzz/inner.ts', 'aaa.ts']);
  });

  it('reports an unreadable directory per entry rather than aborting', async () => {
    const before = await tree({ 'ok.txt': 'x' });
    const after = await tree({ 'ok.txt': 'x' });

    const failing = {
      ...nodeHostFs,
      listDir: async (path: string) => {
        if (path.endsWith('secret')) throw new Error('EACCES: permission denied');
        const entries = await nodeHostFs.listDir(path);
        return path === before ? [...entries, secretDir(before)] : entries;
      },
    };

    const { stats, data } = await diffFolders(failing, before, after, options());
    expect(stats.errors).toBe(1);
    expect(data.rows.find((row) => row.path === 'secret')?.note).toContain('permission denied');
    // ...and the readable file is still compared.
    expect(data.rows.find((row) => row.path === 'ok.txt')?.status).toBe('same');
  });

  it('honours the abort signal mid-scan', async () => {
    const before = await tree({ 'a.txt': 'x' });
    const after = await tree({ 'a.txt': 'x' });

    await expect(
      diffFolders(nodeHostFs, before, after, options(), { shouldAbort: () => true }),
    ).rejects.toThrow(/cancelled/i);
  });
});

function secretDir(root: string): {
  name: string;
  path: string;
  isDirectory: boolean;
  isSymlink: boolean;
} {
  return { name: 'secret', path: join(root, 'secret'), isDirectory: true, isSymlink: false };
}

describe('folderEngine', () => {
  const ctx = (): EngineCtx => ({
    signal: new AbortController().signal,
    progress: () => undefined,
    fs: nodeHostFs,
  });
  const ref = (side: 'A' | 'B', path: string): InputRef => ({
    side,
    kind: 'folder',
    name: 'root/',
    path,
    size: 0,
  });

  it('claims two folders and nothing else', () => {
    expect(folderEngine.canHandle(ref('A', '/a'), ref('B', '/b'))).toBe(true);
    expect(folderEngine.canHandle({ ...ref('A', '/a'), kind: 'text' }, ref('B', '/b'))).toBe(false);
  });

  it('reports identical count, renames and the byte delta as extras', async () => {
    const before = await tree({ 'keep.txt': 'same', 'grow.txt': 'ab' });
    const after = await tree({ 'keep.txt': 'same', 'grow.txt': 'abcd' });

    const result = await folderEngine.compare(
      ref('A', before),
      ref('B', after),
      folderEngine.defaultOptions(),
      ctx(),
    );

    expect(result.summary.modified).toBe(1);
    expect(result.summary.extra?.identical).toBe(1);
    expect(result.summary.extra?.size).toBe('＋2 B');
  });

  it('refuses inputs that are not on disk, with a reason', async () => {
    await expect(
      folderEngine.compare(
        { side: 'A', kind: 'folder', name: 'a/', size: 0 },
        ref('B', '/tmp'),
        folderEngine.defaultOptions(),
        ctx(),
      ),
    ).rejects.toThrow(/two folders on disk/);
  });

  it('reports progress while it scans', async () => {
    const before = await tree({ 'a.txt': 'x' });
    const after = await tree({ 'a.txt': 'x' });
    const percents: number[] = [];

    await folderEngine.compare(ref('A', before), ref('B', after), folderEngine.defaultOptions(), {
      signal: new AbortController().signal,
      progress: (percent) => percents.push(percent),
      fs: nodeHostFs,
    });

    expect(percents[0]).toBeLessThan(100);
    expect(percents.at(-1)).toBe(100);
  });
});
