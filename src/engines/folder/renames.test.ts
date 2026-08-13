import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { nodeHostFs } from '../../engine-worker/hostFs';
import {
  detectRenamesV2,
  MAX_PAIRS,
  renameNote,
  scorePair,
  signatureOf,
  signatureSimilarity,
  sizeProximity,
} from './renames';
import { diffFolders, DEFAULT_FOLDER_OPTIONS } from './folderDiff';

describe('sizeProximity', () => {
  it('is 1 for equal sizes and falls off with the difference', () => {
    expect(sizeProximity(100, 100)).toBe(1);
    expect(sizeProximity(100, 50)).toBeCloseTo(0.5);
    expect(sizeProximity(100, 0)).toBe(0);
    // Two empty files are the same length, not incomparable.
    expect(sizeProximity(0, 0)).toBe(1);
  });
});

describe('signatures', () => {
  const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

  it('is identical for identical content', () => {
    const one = signatureOf(bytes('hello world, this is a longer body of text'));
    const two = signatureOf(bytes('hello world, this is a longer body of text'));
    expect(signatureSimilarity(one, two)).toBe(1);
  });

  it('reports partial similarity for a partial edit', () => {
    const original = 'a'.repeat(400) + 'b'.repeat(400);
    const edited = 'a'.repeat(400) + 'c'.repeat(400);
    const score = signatureSimilarity(signatureOf(bytes(original)), signatureOf(bytes(edited)));
    expect(score).toBeGreaterThan(0.3);
    expect(score).toBeLessThan(0.8);
  });

  it('reports nothing in common for unrelated content', () => {
    const score = signatureSimilarity(
      signatureOf(bytes('x'.repeat(800))),
      signatureOf(bytes('y'.repeat(800))),
    );
    expect(score).toBe(0);
  });

  it('handles empty content without dividing by zero', () => {
    expect(signatureOf(new Uint8Array())).toEqual([]);
    expect(signatureSimilarity([], [1, 2])).toBe(0);
  });
});

describe('scorePair', () => {
  const entry = (path: string, size: number) => ({ path, size });

  it('scores identical content 100, whatever the names', () => {
    expect(
      scorePair(entry('src/old.ts', 100), entry('lib/totally-new.ts', 100), { identical: true }),
    ).toEqual({ score: 100, reason: 'identical' });
  });

  it('scores a same-named file in another folder as a move', () => {
    // The commonest rename there is, and the one v1 could not see at all.
    const result = scorePair(entry('src/a.ts', 100), entry('src/lib/a.ts', 100), {
      identical: false,
      similarity: 0.5,
    });
    expect(result.reason).toBe('moved');
    expect(result.score).toBeGreaterThanOrEqual(70);
  });

  it('scores a move higher when the content also matches', () => {
    const edited = scorePair(entry('src/a.ts', 100), entry('lib/a.ts', 100), {
      identical: false,
      similarity: 0.2,
    });
    const intact = scorePair(entry('src/a.ts', 100), entry('lib/a.ts', 100), {
      identical: false,
      similarity: 0.95,
    });
    expect(intact.score).toBeGreaterThan(edited.score);
  });

  it('lets content argue for a rename in place', () => {
    const result = scorePair(entry('src/old.ts', 100), entry('src/new.ts', 105), {
      identical: false,
      similarity: 0.9,
    });
    expect(result.reason).toBe('similar');
    expect(result.score).toBeGreaterThan(70);
  });

  it('scores two unrelated files low enough to be rejected', () => {
    const result = scorePair(entry('src/a.ts', 100), entry('docs/readme.md', 9000), {
      identical: false,
      similarity: 0,
    });
    expect(result.score).toBeLessThan(50);
  });

  it('falls back to size alone when content could not be read', () => {
    // No `similarity`: a file that could not be sampled still gets judged, not skipped.
    const close = scorePair(entry('a/x.bin', 1000), entry('b/x.bin', 1010), { identical: false });
    expect(close.reason).toBe('moved');
    expect(close.score).toBeGreaterThan(90);
  });
});

describe('detectRenamesV2', () => {
  let root: string;

  const write = async (path: string, content: string): Promise<void> => {
    const full = join(root, path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, content);
  };

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'twinscope-renames-'));
    await write('before/src/moved.ts', 'export const value = 1;\n');
    await write('after/src/lib/moved.ts', 'export const value = 1;\n');
    await write('before/src/renamed-old.ts', `${'shared body\n'.repeat(40)}old tail\n`);
    await write('after/src/renamed-new.ts', `${'shared body\n'.repeat(40)}new tail\n`);
    await write('before/unrelated.ts', 'nothing alike at all\n');
    await write('after/other.ts', `${'x'.repeat(5000)}\n`);
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const roots = () => ({ before: join(root, 'before'), after: join(root, 'after') });

  it('finds a move across directories, scored 100 for identical content', async () => {
    const { pairs } = await detectRenamesV2(
      nodeHostFs,
      roots(),
      [{ path: 'src/moved.ts', size: 24 }],
      [{ path: 'src/lib/moved.ts', size: 24 }],
      { threshold: 50 },
    );
    expect(pairs).toEqual([
      { removed: 'src/moved.ts', added: 'src/lib/moved.ts', score: 100, reason: 'identical' },
    ]);
  });

  it('finds a rename whose content was also edited', async () => {
    const { pairs } = await detectRenamesV2(
      nodeHostFs,
      roots(),
      [{ path: 'src/renamed-old.ts', size: 489 }],
      [{ path: 'src/renamed-new.ts', size: 489 }],
      { threshold: 50 },
    );
    expect(pairs).toHaveLength(1);
    expect(pairs[0]?.score).toBeGreaterThanOrEqual(50);
    expect(pairs[0]?.score).toBeLessThan(100);
  });

  it('refuses a pair that is only alike in being a file', async () => {
    const { pairs } = await detectRenamesV2(
      nodeHostFs,
      roots(),
      [{ path: 'unrelated.ts', size: 21 }],
      [{ path: 'other.ts', size: 5001 }],
      { threshold: 50 },
    );
    expect(pairs).toEqual([]);
  });

  it('honours the threshold', async () => {
    const strict = await detectRenamesV2(
      nodeHostFs,
      roots(),
      [{ path: 'src/renamed-old.ts', size: 489 }],
      [{ path: 'src/renamed-new.ts', size: 489 }],
      { threshold: 99 },
    );
    expect(strict.pairs).toEqual([]);
  });

  it('never pairs one file twice', async () => {
    const { pairs } = await detectRenamesV2(
      nodeHostFs,
      roots(),
      [
        { path: 'src/moved.ts', size: 24 },
        { path: 'unrelated.ts', size: 21 },
      ],
      [
        { path: 'src/lib/moved.ts', size: 24 },
        { path: 'other.ts', size: 5001 },
      ],
      { threshold: 10 },
    );
    const removed = pairs.map((pair) => pair.removed);
    const added = pairs.map((pair) => pair.added);
    expect(new Set(removed).size).toBe(removed.length);
    expect(new Set(added).size).toBe(added.length);
  });

  it('falls back to the cheap rule past the pair cap, and SAYS so', async () => {
    // Scoring is |removals| × |additions|; a 10k-file tree must not go quadratic in
    // silence. The note is the point of this test.
    const many = (prefix: string, count: number) =>
      Array.from({ length: count }, (_, index) => ({ path: `${prefix}/f${index}.ts`, size: 10 }));
    const side = Math.ceil(Math.sqrt(MAX_PAIRS)) + 5;

    const { notes, degraded } = await detectRenamesV2(
      nodeHostFs,
      roots(),
      many('a', side),
      many('a', side),
      { threshold: 50 },
    );
    expect(degraded).toBe(true);
    expect(notes.join(' ')).toContain('too many pairs to score');
  });

  it('will not pair two tiny files that merely look alike', async () => {
    // `export const gone = true;` against `export const added = true;` — different
    // files, and at 27 bytes the chunk signature says they are 60% the same. The
    // folder spec caught this reporting three renames where two were real.
    await write('before/gone.ts', 'export const gone = true;\n');
    await write('after/added.ts', 'export const added = true;\n');

    const { pairs, notes } = await detectRenamesV2(
      nodeHostFs,
      roots(),
      [{ path: 'gone.ts', size: 26 }],
      [{ path: 'added.ts', size: 27 }],
      { threshold: 50 },
    );
    expect(pairs).toEqual([]);
    expect(notes.join(' ')).toContain('too small');
  });

  it('still pairs a tiny file that MOVED, since the name carries it', async () => {
    await write('before/tiny/small.ts', 'export const x = 1;\n');
    await write('after/small.ts', 'export const x = 1;\n');

    const { pairs } = await detectRenamesV2(
      nodeHostFs,
      roots(),
      [{ path: 'tiny/small.ts', size: 20 }],
      [{ path: 'small.ts', size: 20 }],
      { threshold: 50 },
    );
    // Identical content still hashes equal, whatever the size.
    expect(pairs[0]).toMatchObject({ score: 100, reason: 'identical' });
  });

  it('works without a filesystem, on names and sizes alone', async () => {
    const { pairs } = await detectRenamesV2(
      undefined,
      roots(),
      [{ path: 'src/a.ts', size: 100 }],
      [{ path: 'src/lib/a.ts', size: 100 }],
      { threshold: 50 },
    );
    // No content to compare, but a same-named file one directory down is still a move.
    expect(pairs[0]).toMatchObject({ reason: 'moved' });
  });
});

describe('renameNote', () => {
  it('puts the score in the note, so a weak match reads as weak', () => {
    expect(renameNote('from', 'src/old.ts', 92)).toBe('renamed from src/old.ts (92%)');
    expect(renameNote('to', 'src/new.ts', 51)).toBe('renamed to src/new.ts (51%)');
  });
});

describe('the folder engine, end to end', () => {
  let root: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'twinscope-renames-e2e-'));
    const write = async (path: string, content: string): Promise<void> => {
      const full = join(root, path);
      await mkdir(dirname(full), { recursive: true });
      await writeFile(full, content);
    };
    await write('before/src/deep/config.ts', 'export const config = { a: 1 };\n');
    await write('after/config.ts', 'export const config = { a: 1 };\n');
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('reports a file that moved up a directory as one rename', async () => {
    // v1 required the same parent folder, so this read as a deletion plus an
    // addition — the single most common rename it could not see.
    const { stats, data } = await diffFolders(
      nodeHostFs,
      join(root, 'before'),
      join(root, 'after'),
      { ...DEFAULT_FOLDER_OPTIONS, ignore: [] },
    );

    expect(stats.renames).toBe(1);
    expect(data.rows.find((row) => row.path === 'config.ts')?.note).toBe(
      'renamed from src/deep/config.ts (100%)',
    );
  });
});
