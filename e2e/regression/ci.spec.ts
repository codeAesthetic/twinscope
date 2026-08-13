import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, test } from '@playwright/test';

/**
 * REGRESSION — v0.3.4: thresholds, annotations and the job summary.
 *
 * Spawns the **built** CLI, like `cli.spec.ts`, and launches no Electron. The point of
 * doing it here rather than in a unit test is the exit code: a pipeline goes red or
 * green on the real process's real status, and everything else about this feature is
 * downstream of that.
 */

const CLI = resolve(__dirname, '../../out/cli/index.js');

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

function cli(args: string[], env: Record<string, string> = {}): Promise<Run> {
  return new Promise((resolvePromise, reject) => {
    execFile(
      process.execPath,
      [CLI, ...args],
      {
        env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: undefined, ...env },
        maxBuffer: 32 * 1024 * 1024,
      },
      (cause, stdout, stderr) => {
        const code = (cause as (Error & { code?: number }) | null)?.code ?? 0;
        if (cause !== null && typeof code !== 'number') {
          reject(cause);
          return;
        }
        resolvePromise({ code, stdout: String(stdout), stderr: String(stderr) });
      },
    ).stdin?.end();
  });
}

const CONTRACT = (fields: Record<string, string>, required: string[] = []): string =>
  JSON.stringify({
    openapi: '3.0.3',
    info: { title: 'Orders', version: '1' },
    paths: {
      '/orders': {
        post: {
          requestBody: {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required,
                  properties: Object.fromEntries(
                    Object.entries(fields).map(([name, type]) => [name, { type }]),
                  ),
                },
              },
            },
          },
          responses: {
            '200': { content: { 'application/json': { schema: { type: 'object' } } } },
          },
        },
      },
    },
  });

test('ci: a threshold takes over the exit code, and says which one failed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'twinscope-ci-'));

  try {
    const before = join(root, 'a.txt');
    const after = join(root, 'b.txt');
    await writeFile(before, 'one\ntwo\nthree\n');
    await writeFile(after, 'one\nTWO changed\nthree\nfour\n');

    // ---------- without a threshold, "different" is exit 1 ----------
    const plain = await cli([before, after]);
    expect(plain.code).toBe(1);

    // ---------- with a generous threshold, the same comparison passes ----------
    const generous = await cli([before, after, '--max-changes', '10']);
    expect(generous.code).toBe(0);
    expect(generous.stdout).toMatch(/ok\s+changes 3 ≤ allowed 10/);

    // ---------- with a strict one, it fails and names the number ----------
    const strict = await cli([before, after, '--max-changes', '1']);
    expect(strict.code).toBe(1);
    expect(strict.stdout).toMatch(/FAIL\s+changes 3 > allowed 1/);

    // ---------- an identical pair passes a threshold of zero ----------
    const same = await cli([before, before, '--max-changes', '0']);
    expect(same.code).toBe(0);

    // ---------- a threshold that cannot be evaluated fails, rather than passing ----------
    const unevaluable = await cli([before, after, '--max-diff', '1']);
    expect(unevaluable.code).toBe(1);
    expect(unevaluable.stdout).toMatch(/no difference percentage/);

    // ---------- a bad threshold is refused before anything runs ----------
    const nonsense = await cli([before, after, '--max-changes', 'lots']);
    expect(nonsense.code).toBe(2);
    expect(nonsense.stderr).toMatch(/needs a number/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('ci: --fail-on-breaking reads the API verdict, and --github writes both outputs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'twinscope-ci-api-'));

  try {
    const v1 = join(root, 'openapi.v1.json');
    const v2 = join(root, 'openapi.v2.json');
    const v3 = join(root, 'openapi.v3.json');
    await writeFile(v1, CONTRACT({ item: 'string', note: 'string' }, ['item']));
    // `note` becomes required → breaking.
    await writeFile(v2, CONTRACT({ item: 'string', note: 'string' }, ['item', 'note']));
    // A new optional field → compatible.
    await writeFile(v3, CONTRACT({ item: 'string', note: 'string', tag: 'string' }, ['item']));

    // ---------- a compatible change passes ----------
    const compatible = await cli([v1, v3, '--fail-on-breaking']);
    expect(compatible.code).toBe(0);
    expect(compatible.stdout).toMatch(/ok\s+0 breaking changes/);

    // ---------- a breaking one fails ----------
    const breaking = await cli([v1, v2, '--fail-on-breaking']);
    expect(breaking.code).toBe(1);
    expect(breaking.stdout).toMatch(/FAIL\s+1 breaking change\b/);

    // ---------- --github: annotations on stdout, summary into the runner's file ----------
    const summaryPath = join(root, 'summary.md');
    const github = await cli([v1, v2, '--fail-on-breaking', '--github'], {
      GITHUB_STEP_SUMMARY: summaryPath,
    });
    expect(github.code).toBe(1);
    expect(github.stdout).toContain('::error title=TwinScope threshold::');
    // The annotation must be one line: a raw newline would end the workflow command.
    expect(github.stdout.trim().split('\n')).toHaveLength(1);

    const summary = await readFile(summaryPath, 'utf8');
    expect(summary).toContain('### TwinScope');
    expect(summary).toContain('| Threshold | Result |');
    expect(summary).toContain('❌');
    // Rule 3 in a job summary: what the comparison did, folded away.
    expect(summary).toContain('<details><summary>What the comparison did</summary>');

    // ---------- a passing comparison annotates a notice, not an error ----------
    const ok = await cli([v1, v3, '--fail-on-breaking', '--github'], {
      GITHUB_STEP_SUMMARY: join(root, 'ok.md'),
    });
    expect(ok.code).toBe(0);
    expect(ok.stdout).toContain('::notice title=TwinScope::');
    expect(ok.stdout).not.toContain('::error');

    // ---------- --json carries the verdict for a step that wants to read it ----------
    const asJson = await cli([v1, v2, '--fail-on-breaking', '--json']);
    const parsed = JSON.parse(asJson.stdout) as {
      thresholds?: { failed: boolean; failures: string[] };
    };
    expect(parsed.thresholds?.failed).toBe(true);
    expect(parsed.thresholds?.failures[0]).toMatch(/breaking/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
