import { execFile, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, test } from '@playwright/test';

/**
 * REGRESSION — v0.2.2: the `twinscope` command line.
 *
 * This is the only spec that launches no Electron: it spawns the **built** CLI as
 * a real child process and reads its stdout, its files and its exit code. Testing
 * `main()` in vitest would prove the logic but not the thing a user runs — the
 * shebang, the bundle, the version define and the exit code all live outside it.
 *
 * It sits under `e2e/regression/` rather than in vitest deliberately: like every
 * other spec here it needs `npm run build` to have happened, and `npm run build`
 * now builds the CLI too.
 */

const CLI = resolve(__dirname, '../../out/cli/index.js');

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Spawns the CLI. `NO_COLOR` is set so assertions compare text rather than escape
 * sequences — the no-colour path is unit-tested, and stdout is a pipe here anyway.
 */
function cli(args: string[], options: { cwd?: string; stdin?: string } = {}): Promise<Run> {
  return new Promise((resolvePromise, reject) => {
    const child = execFile(
      process.execPath,
      [CLI, ...args],
      {
        ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
        // FORCE_COLOR is deleted, not just overridden: Playwright sets it, and
        // Node warns to stderr when both it and NO_COLOR are present — which would
        // land in the stderr these tests assert on.
        env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: undefined },
        maxBuffer: 32 * 1024 * 1024,
      },
      (cause, stdout, stderr) => {
        // A non-zero exit is the whole point here, so it must not reject.
        const code = (cause as (Error & { code?: number }) | null)?.code ?? 0;
        if (cause !== null && typeof code !== 'number') {
          reject(cause);
          return;
        }
        resolvePromise({ code, stdout: String(stdout), stderr: String(stderr) });
      },
    );

    if (options.stdin !== undefined) {
      child.stdin?.end(options.stdin);
    } else {
      child.stdin?.end();
    }
  });
}

async function fixtures(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'twinscope-cli-'));
  const files: Record<string, string> = {
    'before.txt': 'alpha\nbeta\ngamma\n',
    'after.txt': 'alpha\nBETA CHANGED\ngamma\ndelta\n',
    'same-a.txt': 'identical\n',
    'same-b.txt': 'identical\n',
    'before.json': '{"name":"one","keep":true}\n',
    'after.json': '{"name":"two","keep":true,"extra":1}\n',
    'tree-a/file.txt': 'a\n',
    'tree-a/gone.txt': 'x\n',
    'tree-b/file.txt': 'b\n',
    'tree-b/new.txt': 'y\n',
  };
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, content);
  }
  return root;
}

test('cli: the built binary exists and answers --help and --version', async () => {
  expect(existsSync(CLI), `no CLI at ${CLI} — run npm run build`).toBe(true);

  const help = await cli(['--help']);
  expect(help.code).toBe(0);
  expect(help.stdout).toContain('twinscope — compare anything');
  expect(help.stdout).toContain('EXIT CODES');

  // No arguments is a help request, not an error: a bare `twinscope` should teach.
  const bare = await cli([]);
  expect(bare.code).toBe(0);
  expect(bare.stdout).toContain('USAGE');

  const version = await cli(['--version']);
  expect(version.code).toBe(0);
  // Injected at build time from package.json, so this proves the define works.
  expect(version.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
});

test('cli: exit codes are the contract — 0 same, 1 different, 2 error', async () => {
  const root = await fixtures();

  try {
    const same = await cli(['same-a.txt', 'same-b.txt'], { cwd: root });
    expect(same.code).toBe(0);
    expect(same.stdout).toContain('No differences.');

    const different = await cli(['before.txt', 'after.txt'], { cwd: root });
    expect(different.code).toBe(1);
    expect(different.stdout).toContain('added');

    const missing = await cli(['before.txt', 'nope.txt'], { cwd: root });
    expect(missing.code).toBe(2);
    expect(missing.stderr).toContain('nope.txt does not exist.');
    expect(missing.stdout).toBe('');

    // A usage mistake is also a 2, and it says what was wrong.
    const bad = await cli(['before.txt', 'after.txt', '--htlm'], { cwd: root });
    expect(bad.code).toBe(2);
    expect(bad.stderr).toContain('Unknown option --htlm');

    const noEngine = await cli(['before.txt', 'after.txt', '--engine', 'nonesuch'], { cwd: root });
    expect(noEngine.code).toBe(2);
    expect(noEngine.stderr).toContain('There is no "nonesuch" engine.');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('cli: detection picks the engine, and --engine overrides it', async () => {
  const root = await fixtures();

  try {
    // Rule 1: two .json files need no flag to get the structural engine.
    const json = await cli(['before.json', 'after.json'], { cwd: root });
    expect(json.code).toBe(1);
    expect(json.stdout).toContain('JSON');

    // The same pair as text is a different, still-correct answer.
    const asText = await cli(['before.json', 'after.json', '--engine', 'text'], { cwd: root });
    expect(asText.stdout).toContain('Text');

    const folders = await cli(['tree-a', 'tree-b'], { cwd: root });
    expect(folders.code).toBe(1);
    expect(folders.stdout).toContain('tree');
    expect(folders.stdout).toContain('added');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('cli: --json is parseable and carries the same verdict as the exit code', async () => {
  const root = await fixtures();

  try {
    const run = await cli(['before.json', 'after.json', '--json'], { cwd: root });
    expect(run.code).toBe(1);

    const parsed = JSON.parse(run.stdout) as {
      identical: boolean;
      engine: { id: string };
      summary: { added: number; removed: number; modified: number };
      normalizationNotes: string[];
    };
    expect(parsed.identical).toBe(false);
    expect(parsed.engine.id).toBe('json');
    expect(parsed.summary.modified).toBeGreaterThan(0);
    expect(Array.isArray(parsed.normalizationNotes)).toBe(true);

    const same = await cli(['same-a.txt', 'same-b.txt', '--json'], { cwd: root });
    expect(same.code).toBe(0);
    expect((JSON.parse(same.stdout) as { identical: boolean }).identical).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('cli: reports go to stdout or --out, and contain no escape sequences', async () => {
  const root = await fixtures();

  try {
    const md = await cli(['before.txt', 'after.txt', '--md'], { cwd: root });
    expect(md.code).toBe(1);
    expect(md.stdout).toContain('# before.txt ↔ after.txt');
    expect(md.stdout).toContain('```diff');

    const out = join(root, 'report.md');
    const written = await cli(['before.txt', 'after.txt', '--md', '--out', out], { cwd: root });
    expect(written.code).toBe(1);
    // Progress goes to stderr so `--out` leaves stdout empty and scriptable.
    expect(written.stdout).toBe('');
    expect(written.stderr).toContain('wrote');

    const file = await readFile(out, 'utf8');
    // Byte-identical to what stdout produced, because it is the same renderer the
    // app's Export uses — that is why `shared/report/` is shared.
    expect(file).toBe(md.stdout);
    // eslint-disable-next-line no-control-regex
    expect(/\[/.test(file), 'a written report must never contain ANSI escapes').toBe(false);

    const html = await cli(['before.txt', 'after.txt', '--html'], { cwd: root });
    expect(html.stdout).toContain('<!doctype html>');
    expect(html.stdout).not.toContain('http://');

    const patch = await cli(['before.txt', 'after.txt', '--patch'], { cwd: root });
    expect(patch.stdout).toContain('--- ');
    expect(patch.stdout).toContain('+++ ');
    expect(patch.stdout).toContain('+delta');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('cli: - reads one side from stdin', async () => {
  const root = await fixtures();

  try {
    const piped = await cli(['before.txt', '-'], {
      cwd: root,
      stdin: 'alpha\nBETA CHANGED\ngamma\ndelta\n',
    });
    expect(piped.code).toBe(1);
    expect(piped.stdout).toContain('stdin');

    // The piped side can be the BEFORE one just as well.
    const other = await cli(['-', 'after.txt'], { cwd: root, stdin: 'alpha\nbeta\ngamma\n' });
    expect(other.code).toBe(1);

    // Identical content through the pipe still exits 0.
    const same = await cli(['same-a.txt', '-'], { cwd: root, stdin: 'identical\n' });
    expect(same.code).toBe(0);

    const both = await cli(['-', '-'], { cwd: root, stdin: 'x\n' });
    expect(both.code).toBe(2);
    expect(both.stderr).toContain('Only one side can come from stdin.');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('cli: -q prints nothing and says everything through the exit code', async () => {
  const root = await fixtures();

  try {
    const quiet = await cli(['before.txt', 'after.txt', '--quiet'], { cwd: root });
    expect(quiet.code).toBe(1);
    expect(quiet.stdout).toBe('');

    const quietSame = await cli(['same-a.txt', 'same-b.txt', '-q'], { cwd: root });
    expect(quietSame.code).toBe(0);
    expect(quietSame.stdout).toBe('');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('cli: --repo compares two git refs, reusing the v0.2.1 engine', async () => {
  const root = await mkdtemp(join(tmpdir(), 'twinscope-cli-git-'));

  const git = (args: string[]): void => {
    execFileSync('git', args, {
      cwd: root,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'TwinScope Test',
        GIT_AUTHOR_EMAIL: 'test@example.invalid',
        GIT_COMMITTER_NAME: 'TwinScope Test',
        GIT_COMMITTER_EMAIL: 'test@example.invalid',
      },
    });
  };

  try {
    git(['-c', 'init.defaultBranch=main', 'init', '--quiet', root]);
    git(['config', 'user.name', 'TwinScope Test']);
    git(['config', 'user.email', 'test@example.invalid']);
    await writeFile(join(root, 'a.txt'), 'one\n');
    git(['add', '-A']);
    git(['commit', '--quiet', '-m', 'first']);
    await writeFile(join(root, 'a.txt'), 'two\n');
    await writeFile(join(root, 'b.txt'), 'new\n');

    const run = await cli(['--repo', root, 'HEAD', 'WORKTREE', '--json']);
    expect(run.code).toBe(1);
    const parsed = JSON.parse(run.stdout) as {
      engine: { id: string };
      before: { ref: string };
      after: { ref: string };
      summary: { added: number; modified: number };
    };
    expect(parsed.engine.id).toBe('git');
    expect(parsed.before.ref).toBe('HEAD');
    expect(parsed.after.ref).toBe('WORKTREE');
    // b.txt is untracked, so plain `git diff` would miss it entirely — the engine
    // adds `ls-files --others` for exactly this case and says so in its notes.
    expect(parsed.summary.added).toBe(1);
    expect(parsed.summary.modified).toBe(1);
    expect(run.stdout).toContain('untracked');

    // The ref allowlist holds here too — this is the second enforcement point.
    const injected = await cli(['--repo', root, 'HEAD', '--upload-pack=/bin/sh']);
    expect(injected.code).toBe(2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('cli: a PNG pair compares, and a JPEG says why it cannot', async () => {
  const root = await mkdtemp(join(tmpdir(), 'twinscope-cli-png-'));

  try {
    await writeFile(join(root, 'a.png'), png(4, 4, [255, 0, 0, 255]));
    await writeFile(join(root, 'b.png'), png(4, 4, [255, 0, 0, 255]));
    await writeFile(join(root, 'c.png'), png(4, 4, [0, 0, 255, 255]));

    const identical = await cli(['a.png', 'b.png'], { cwd: root });
    expect(identical.code).toBe(0);

    const different = await cli(['a.png', 'c.png', '--json'], { cwd: root });
    expect(different.code).toBe(1);
    const parsed = JSON.parse(different.stdout) as { summary: { extra?: Record<string, string> } };
    expect(parsed.summary.extra?.difference).toBe('100.00%');

    // D7's adapter is PNG-only, and it names the limit rather than guessing.
    await writeFile(join(root, 'a.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]));
    await writeFile(join(root, 'b.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 1]));
    const jpeg = await cli(['a.jpg', 'b.jpg'], { cwd: root });
    expect(jpeg.code).toBe(2);
    expect(jpeg.stderr).toContain('can only decode PNG');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

/**
 * A minimal single-colour PNG, hand-encoded.
 *
 * The image spec (MVP-7) needs the same thing and for the same reason: a fixture
 * PNG has to be generated rather than committed, or the repo carries binaries
 * nobody can review.
 */
function png(
  width: number,
  height: number,
  rgba: [number, number, number, number] | number[],
): Buffer {
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (1 + width * 4);
    raw[rowStart] = 0; // filter: none
    for (let x = 0; x < width; x += 1) {
      const at = rowStart + 1 + x * 4;
      raw[at] = rgba[0] as number;
      raw[at + 1] = rgba[1] as number;
      raw[at + 2] = rgba[2] as number;
      raw[at + 3] = rgba[3] as number;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.byteLength, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
