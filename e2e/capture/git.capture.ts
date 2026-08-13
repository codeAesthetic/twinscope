import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { expect, test } from '@playwright/test';
import { freshWorkDir } from './helpers/fixtures';
import { stage, still, stubPicker } from './helpers/stage';

/**
 * MEDIA-1 still for the git engine (v0.2.1).
 *
 * The repository is **real**: the capture process runs `git init`, commits three
 * times, tags one of them, branches, and then dirties the working tree. Nothing
 * about git is stubbed, which is the whole point of shelling out to it — a mocked
 * repository would photograph our idea of `git diff` rather than git's.
 *
 * It is built in the fixed work directory rather than a `mkdtemp` one because the
 * repository name reaches the picture: the titlebar reads `acme-orders @ v1.4.0`,
 * and a random temp id there would change the PNG on every run.
 *
 * The comparison in frame is **a tag against the working tree**, the one shape that
 * shows all of it at once: a released ref on the left, the files as they are on disk
 * on the right, an uncommitted edit, and an untracked file — the last of which plain
 * `git diff` never reports, so the engine runs a second command to find it. See the
 * note on that further down: the file makes the list, its explanation does not.
 */

const PACKAGE_JSON = `{
  "name": "acme-orders",
  "version": "1.3.0",
  "private": true
}
`;

const README = `# acme-orders

The orders service.

## Changelog
`;

const RETRY_BEFORE = `export interface RetryOptions {
  attempts: number;
  timeoutMs: number;
}

export const defaults: RetryOptions = {
  attempts: 2,
  timeoutMs: 5_000,
};

export async function withRetry<T>(run: () => Promise<T>, options = defaults): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < options.attempts; attempt += 1) {
    try {
      return await run();
    } catch (cause) {
      last = cause;
    }
  }
  throw last;
}
`;

const RETRY_AFTER = RETRY_BEFORE.replace('attempts: 2', 'attempts: 4').replace(
  'timeoutMs: 5_000',
  'timeoutMs: 8_000',
);

const BANNER = `export function Banner({ text }: { text: string }) {
  return (
    <aside className="banner" role="status">
      {text}
    </aside>
  );
}
`;

const TOAST = `export function Toast({ text }: { text: string }) {
  return (
    <output className="toast" aria-live="polite">
      {text}
    </output>
  );
}
`;

const LOGGER_BEFORE = `export function log(level: string, message: string): void {
  process.stdout.write(\`\${level} \${message}\\n\`);
}
`;

const ORDERS_BEFORE = `export function orders(): Response {
  return Response.json({ orders: [] });
}
`;

const CI_BEFORE = `name: ci
on: [push]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npm test
`;

const FIRST_COMMIT: Record<string, string> = {
  'package.json': PACKAGE_JSON,
  'README.md': README,
  '.github/workflows/ci.yml': CI_BEFORE,
  'src/server.ts': `import { createServer } from 'node:http';
import { orders } from './routes/orders';

createServer(orders).listen(8080);
`,
  'src/routes/orders.ts': ORDERS_BEFORE,
  'src/lib/retry.ts': RETRY_BEFORE,
  'src/lib/logger.ts': LOGGER_BEFORE,
  'src/legacy/soap-client.ts': `// Retired with the 1.5 line: nothing calls this any more.
export function soapCall(action: string): never {
  throw new Error(\`SOAP is gone: \${action}\`);
}
`,
  'src/legacy/xml-shim.ts': `// Retired with the 1.5 line: the orders API is JSON now.
export function toXml(value: unknown): string {
  return \`<payload>\${JSON.stringify(value)}</payload>\`;
}
`,
  'ui/OldBanner.tsx': BANNER,
  'ui/OldToast.tsx': TOAST,
};

/** What `main` has done since the tag, and what is still only on disk. */
const SINCE_RELEASE: Record<string, string> = {
  'package.json': PACKAGE_JSON.replace('1.3.0', '1.5.0-rc.1'),
  '.github/workflows/ci.yml': CI_BEFORE.replace('- run: npm test', '- run: npm run gate'),
  'src/lib/retry.ts': RETRY_AFTER,
  'src/lib/logger.ts': LOGGER_BEFORE.replace(
    'process.stdout.write(`${level} ${message}\\n`);',
    'process.stdout.write(`${new Date().toISOString()} ${level} ${message}\\n`);',
  ),
  'src/routes/orders.ts': ORDERS_BEFORE.replace(
    'Response.json({ orders: [] })',
    'Response.json({ orders: [], page: 1 })',
  ),
  'src/routes/refunds.ts': `export function refunds(): Response {
  return Response.json({ refunds: [] });
}
`,
  'docs/api.md': `# API

- GET /orders
- GET /refunds
`,
  'tests/retry.test.ts': `import { withRetry } from '../src/lib/retry';

it('retries four times', async () => {
  await withRetry(async () => undefined);
});
`,
  // Renamed with their content untouched, so git pairs both at 100% similarity.
  'ui/Banner.tsx': BANNER,
  'ui/Toast.tsx': TOAST,
};

const RELEASED_README = `${README}\n- 1.4.0 — retry budget, orders route\n`;
const WORKING_README = `${RELEASED_README}- next — webhooks\n`;

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'TwinScope Docs',
      GIT_AUTHOR_EMAIL: 'docs@example.invalid',
      GIT_COMMITTER_NAME: 'TwinScope Docs',
      GIT_COMMITTER_EMAIL: 'docs@example.invalid',
      GIT_AUTHOR_DATE: '2026-08-10T09:00:00Z',
      GIT_COMMITTER_DATE: '2026-08-10T09:00:00Z',
    },
  });
}

function write(root: string, files: Record<string, string>): void {
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
}

/**
 * Three commits, a tag, a second branch, an uncommitted edit and an untracked file.
 *
 * `-c init.defaultBranch=main` rather than trusting the machine's git config: a host
 * whose default is `master` would otherwise produce a different picture.
 */
function buildRepo(root: string): void {
  git(root, ['-c', 'init.defaultBranch=main', 'init', '--quiet', root]);
  git(root, ['config', 'user.name', 'TwinScope Docs']);
  git(root, ['config', 'user.email', 'docs@example.invalid']);
  git(root, ['config', 'commit.gpgsign', 'false']);

  write(root, FIRST_COMMIT);
  git(root, ['add', '-A']);
  git(root, ['commit', '--quiet', '-m', 'orders service groundwork']);

  // ---------- the release the still compares against ----------
  write(root, {
    'package.json': PACKAGE_JSON.replace('1.3.0', '1.4.0'),
    'README.md': RELEASED_README,
  });
  git(root, ['add', '-A']);
  git(root, ['commit', '--quiet', '-m', 'release 1.4.0']);
  git(root, ['tag', 'v1.4.0']);
  // A maintenance branch at the tag: it is a ref the picker offers, and it is why
  // the tag is worth naming rather than a commit id.
  git(root, ['branch', 'release/1.4']);

  // ---------- and what main has done since ----------
  write(root, SINCE_RELEASE);
  for (const gone of [
    'src/legacy/soap-client.ts',
    'src/legacy/xml-shim.ts',
    'ui/OldBanner.tsx',
    'ui/OldToast.tsx',
  ]) {
    rmSync(join(root, gone));
  }
  git(root, ['add', '-A']);
  git(root, ['commit', '--quiet', '-m', 'drop the legacy shims, widen the retry budget']);

  // ---------- uncommitted, and untracked ----------
  writeFileSync(join(root, 'README.md'), WORKING_README);
  writeFileSync(
    join(root, 'src/routes/webhooks.ts'),
    `// Not committed yet: \`git diff\` alone would not mention this file at all.
export function webhooks(): Response {
  return Response.json({ ok: true });
}
`,
  );
}

test('stills: a tag against the working tree, untracked file included', async () => {
  const harness = await stage();
  expect(harness.target).toBe('app');
  const repo = freshWorkDir('acme-orders');

  try {
    buildRepo(repo);
    await stubPicker(harness, [repo]);

    // ---------- the panel: probing fills both refs from the repository itself ----------
    await harness.page.getByTestId('quick-git').click();
    const panel = harness.page.getByTestId('git-panel');
    await expect(panel).toBeVisible();

    await harness.page.getByTestId('git-pick-repo').click();
    const beforeField = harness.page.getByTestId('git-ref-before');
    await expect(beforeField).toHaveValue('main', { timeout: 30_000 });
    await expect(harness.page.getByTestId('git-ref-after')).toHaveValue('WORKTREE');
    await expect(panel).toContainText('uncommitted changes');
    await expect(harness.page.getByTestId('git-repo-root')).toContainText('acme-orders');

    // Both branches and the tag are offered. A `datalist` popup is native and cannot
    // be photographed, so the options are asserted in the DOM instead — that list is
    // where the picture's `v1.4.0` comes from.
    for (const ref of ['WORKTREE', 'main', 'release/1.4', 'v1.4.0']) {
      await expect(panel.locator(`#dd-git-refs option[value="${ref}"]`)).toHaveCount(1);
    }

    // ---------- the released tag against the files on disk ----------
    await beforeField.fill('v1.4.0');
    await harness.page.getByTestId('git-compare').click();

    const list = harness.page.getByTestId('git-diff');
    await expect(list).toBeVisible({ timeout: 30_000 });
    await expect(harness.page.getByTestId('git-before-label')).toHaveText('v1.4.0');
    await expect(harness.page.getByTestId('git-after-label')).toHaveText('working tree');

    // ---------- every status git can report, in one list ----------
    const status = async (path: string, expected: string): Promise<void> => {
      await expect(list.locator(`[data-path="${path}"]`)).toHaveAttribute('data-status', expected);
    };
    await status('src/routes/refunds.ts', 'add');
    await status('tests/retry.test.ts', 'add');
    await status('src/legacy/soap-client.ts', 'del');
    await status('src/legacy/xml-shim.ts', 'del');
    await status('src/lib/retry.ts', 'mod');
    await status('.github/workflows/ci.yml', 'mod');
    await status('README.md', 'mod');
    await status('ui/Banner.tsx', 'rename');
    await expect(list.locator('[data-path="ui/Banner.tsx"]')).toContainText(
      'from ui/OldBanner.tsx',
    );
    // An unchanged file is not in a git diff at all, unlike a folder comparison.
    await expect(list.locator('[data-path="src/server.ts"]')).toHaveCount(0);

    /*
     * ---------- the untracked file: in the list, unexplained on screen ----------
     *
     * `git diff` never reports an untracked file, so the engine runs a second command
     * (`ls-files --others --exclude-standard`) and writes a note saying it did. The
     * row is here. **The note is not**: `GitDiffView` is one of the views that does
     * not render `result.normalizationNotes`, so nothing on screen says why a file
     * git would not have mentioned is in the list. The note does reach an exported
     * report, which is where it can currently be read.
     *
     * Both halves are asserted, the absence included, so that adding a notes panel to
     * this view fails here and the picture gets retaken.
     */
    await status('src/routes/webhooks.ts', 'add');
    await expect(harness.page.getByTestId('normalize-notes')).toHaveCount(0);

    // ---------- ± counts come from git, per file and in the strip ----------
    const strip = harness.page.getByTestId('summary-strip');
    await expect(strip).toContainText('＋4 added');
    await expect(strip).toContainText('－2 removed');
    // A rename is counted as a change to a file as well as a move, so `modified`
    // covers the six edited files plus the two renames.
    await expect(strip).toContainText('～8 modified');
    await expect(strip).toContainText('2 renamed');
    await expect(list.locator('[data-path="src/lib/retry.ts"] .dd-gitplus')).toHaveText('＋2');

    await still(harness, 'git-refs', { statusBar: false });

    expect(harness.errors, `errors:\n${harness.errors.join('\n')}`).toEqual([]);
  } finally {
    await harness.close();
  }
});
