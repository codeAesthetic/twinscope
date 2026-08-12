import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { nodeHostFs, scopedHostFs } from './hostFs';

/**
 * The containment half of plan §3.7 item 5: a comparison must not read outside
 * the inputs the user chose.
 *
 * These run against the real filesystem rather than a fake, because the property
 * being tested is precisely how the real one resolves symlinks — a fake that
 * "resolves" links the way we imagine would prove nothing.
 */
let root: string;
let picked: string;
let outside: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'twinscope-scope-'));
  picked = join(root, 'picked');
  outside = join(root, 'outside');
  await mkdir(picked, { recursive: true });
  await mkdir(outside, { recursive: true });

  await writeFile(join(picked, 'inside.txt'), 'in the tree');
  await writeFile(join(outside, 'secret.txt'), 'not in the tree');
  await mkdir(join(picked, 'nested'), { recursive: true });
  await writeFile(join(picked, 'nested', 'deep.txt'), 'still in the tree');
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('scopedHostFs', () => {
  it('reads anything under a picked root', async () => {
    const fs = scopedHostFs(nodeHostFs, [picked]);
    expect(await fs.readText(join(picked, 'inside.txt'))).toBe('in the tree');
    expect(await fs.readText(join(picked, 'nested', 'deep.txt'))).toBe('still in the tree');
    expect((await fs.listDir(picked)).map((entry) => entry.name).sort()).toEqual([
      'inside.txt',
      'nested',
    ]);
  });

  it('reads a picked file itself, not only its directory', async () => {
    const file = join(picked, 'inside.txt');
    const fs = scopedHostFs(nodeHostFs, [file]);
    expect(await fs.readText(file)).toBe('in the tree');
  });

  it('refuses a path outside every root', async () => {
    const fs = scopedHostFs(nodeHostFs, [picked]);
    await expect(fs.readText(join(outside, 'secret.txt'))).rejects.toThrow(/outside/i);
    await expect(fs.readBytes(join(outside, 'secret.txt'))).rejects.toThrow(/outside/i);
    await expect(fs.stat(join(outside, 'secret.txt'))).rejects.toThrow(/outside/i);
    await expect(fs.listDir(outside)).rejects.toThrow(/outside/i);
    await expect(fs.hashFile(join(outside, 'secret.txt'))).rejects.toThrow(/outside/i);
  });

  it('refuses to traverse out with ..', async () => {
    const fs = scopedHostFs(nodeHostFs, [picked]);
    await expect(fs.readText(join(picked, '..', 'outside', 'secret.txt'))).rejects.toThrow(
      /outside/i,
    );
  });

  it('refuses a symlink that points out of the tree', async () => {
    // The escape that matters for a folder scan: the link *is* inside the picked
    // root, so only resolving it reveals that its target is not.
    const link = join(picked, 'escape.txt');
    await symlink(join(outside, 'secret.txt'), link);

    const fs = scopedHostFs(nodeHostFs, [picked]);
    await expect(fs.readText(link)).rejects.toThrow(/outside/i);

    // And the unscoped filesystem would happily have followed it, which is what
    // makes the scoped one worth having.
    expect(await nodeHostFs.readText(link)).toBe('not in the tree');
  });

  it('allows a symlink that stays inside the tree', async () => {
    const link = join(picked, 'friendly.txt');
    await symlink(join(picked, 'inside.txt'), link);

    const fs = scopedHostFs(nodeHostFs, [picked]);
    expect(await fs.readText(link)).toBe('in the tree');
  });

  it('reports a missing file as missing, not as a security error', async () => {
    // A scan stats files that vanish mid-walk all the time; that must read as
    // ENOENT rather than as an accusation.
    const fs = scopedHostFs(nodeHostFs, [picked]);
    await expect(fs.readText(join(picked, 'not-there.txt'))).rejects.toThrow(/ENOENT/);
  });

  it('confines to both roots when two inputs are compared', async () => {
    const fs = scopedHostFs(nodeHostFs, [picked, outside]);
    expect(await fs.readText(join(outside, 'secret.txt'))).toBe('not in the tree');
    await expect(fs.readText(join(root, 'elsewhere.txt'))).rejects.toThrow(/outside/i);
  });
});
