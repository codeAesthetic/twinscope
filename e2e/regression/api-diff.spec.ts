import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, test } from '@playwright/test';
import { launchApp, type Harness } from '../helpers/launch';

/**
 * REGRESSION — v0.3.1: the API engine and its view.
 *
 * The engine's rules are unit-tested; what this proves is the part that only exists
 * in the app: two `.json` files are **detected** as API documents rather than
 * line- or tree-diffed, the verdict is the first thing on the screen, and the rule
 * behind each finding is on screen too.
 */

const CONTRACT_BEFORE = JSON.stringify(
  {
    openapi: '3.0.3',
    info: { title: 'Orders', version: '1.0.0' },
    paths: {
      '/orders': {
        get: {
          responses: {
            '200': {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      id: { type: 'string' },
                      total: { type: 'number' },
                      status: { type: 'string', enum: ['open', 'paid', 'void'] },
                    },
                  },
                },
              },
            },
          },
        },
        post: {
          requestBody: {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['item'],
                  properties: { item: { type: 'string' }, note: { type: 'string' } },
                },
              },
            },
          },
          responses: { '201': { content: { 'application/json': { schema: { type: 'object' } } } } },
        },
      },
      '/legacy': { get: { responses: { '200': { description: 'ok' } } } },
    },
  },
  null,
  2,
);

const CONTRACT_AFTER = JSON.stringify(
  {
    openapi: '3.1.0',
    info: { title: 'Orders', version: '2.0.0' },
    paths: {
      '/orders': {
        get: {
          responses: {
            '200': {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      id: { type: 'string' },
                      // `total` removed → breaking. `currency` added → compatible.
                      currency: { type: 'string' },
                      status: { type: 'string', enum: ['open', 'paid'] },
                    },
                  },
                },
              },
            },
          },
        },
        post: {
          requestBody: {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  // `note` is now required → breaking.
                  required: ['item', 'note'],
                  properties: { item: { type: 'string' }, note: { type: 'string' } },
                },
              },
            },
          },
          responses: { '201': { content: { 'application/json': { schema: { type: 'object' } } } } },
        },
      },
      // `/legacy` removed → breaking.
    },
  },
  null,
  2,
);

function harOf(
  entries: Array<{
    url: string;
    status?: number;
    body?: unknown;
    headers?: Record<string, string>;
  }>,
): string {
  return JSON.stringify({
    log: {
      version: '1.2',
      creator: { name: 'twinscope-spec', version: '1' },
      entries: entries.map((entry) => ({
        startedDateTime: '2026-08-13T00:00:00.000Z',
        request: { method: 'GET', url: `https://api.test${entry.url}`, headers: [] },
        response: {
          status: entry.status ?? 200,
          statusText: 'OK',
          headers: Object.entries(entry.headers ?? {}).map(([name, value]) => ({ name, value })),
          content: { mimeType: 'application/json', text: JSON.stringify(entry.body ?? {}) },
        },
      })),
    },
  });
}

async function stage(harness: Harness, files: Array<[string, string]>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'twinscope-api-'));
  const paths: string[] = [];
  for (const [name, content] of files) {
    const path = join(root, name);
    await writeFile(path, content);
    paths.push(path);
  }
  await harness.app.evaluate(({ dialog }, queued: string[]) => {
    let call = 0;
    dialog.showOpenDialog = () =>
      Promise.resolve({ canceled: false, filePaths: [queued[call++ % queued.length] as string] });
  }, paths);
  return root;
}

test('api diff: two contracts, verdict first, every finding naming its rule', async () => {
  const harness = await launchApp();
  let root: string | null = null;

  try {
    root = await stage(harness, [
      ['openapi.v1.json', CONTRACT_BEFORE],
      ['openapi.v2.json', CONTRACT_AFTER],
    ]);

    await harness.page.getByTestId('pick-file-before').click();
    await harness.page.getByTestId('pick-file-after').click();

    // Two `.json` files: without shape detection these would get a structural tree,
    // which answers "what keys changed" instead of "who breaks".
    await expect(harness.page.getByTestId('detected-bar')).toContainText('API diff');

    await harness.page.getByTestId('compare-button').click();
    const view = harness.page.getByTestId('api-view');
    await expect(view).toBeVisible({ timeout: 20_000 });

    // ---------- the verdict is the first thing, and it is the right one ----------
    const verdict = harness.page.getByTestId('api-verdict');
    await expect(verdict).toHaveAttribute('data-breaking', 'true');
    // /legacy gone, total gone, note now required, and the enum lost a value.
    await expect(verdict).toContainText('4 breaking changes');
    await expect(verdict).toContainText('OpenAPI 3.0.3 → 3.1.0');

    await harness.screenshot('api-contract');

    // ---------- each finding names the rule behind it ----------
    await expect(view).toContainText('operation-removed');
    await expect(view).toContainText('response-field-removed');
    await expect(view).toContainText('request-field-now-required');
    await expect(view).toContainText('enum-value-removed');
    // …and the compatible ones are shown too, not hidden.
    await expect(view).toContainText('response-field-added');

    // Breaking first: the first row in the list is a breaking one.
    await expect(harness.page.getByTestId('api-finding-0')).toHaveAttribute(
      'data-verdict',
      'breaking',
    );

    // ---------- the filter keeps only the breaking ones ----------
    await harness.page.getByRole('tab', { name: /^Breaking/ }).click();
    const rows = view.locator('[data-testid^="api-finding-"]');
    await expect(rows).toHaveCount(4);
    await harness.page.getByRole('tab', { name: 'All' }).click();

    // ---------- ⌘F filters, and change-nav counts what is shown ----------
    await harness.page.getByTestId('workspace-search').fill('legacy');
    await expect(view.locator('[data-testid^="api-finding-"]')).toHaveCount(1);
    await harness.page.getByTestId('workspace-search').fill('');

    expect(harness.errors, `errors:\n${harness.errors.join('\n')}`).toEqual([]);
  } finally {
    if (root !== null) await rm(root, { recursive: true, force: true });
    await harness.close();
  }
});

test('api diff: two captures pair by path, and volatile headers are ignored but counted', async () => {
  const harness = await launchApp();
  let root: string | null = null;

  try {
    root = await stage(harness, [
      [
        'session.before.har',
        harOf([
          {
            url: '/v1/orders?page=1&t=1699',
            body: { items: [{ id: 1, total: 10 }] },
            headers: { date: 'Mon', 'cache-control': 'no-store' },
          },
          { url: '/v1/health', body: { ok: true } },
          { url: '/v1/retired', body: { gone: false } },
        ]),
      ],
      [
        'session.after.har',
        harOf([
          // Same request, different cache-buster and a changed total.
          {
            url: '/v1/orders?t=1700&page=1',
            body: { items: [{ id: 1, total: 12 }] },
            headers: { date: 'Tue', 'cache-control': 'max-age=60' },
          },
          { url: '/v1/health', body: { ok: true } },
          { url: '/v1/new', body: { ok: true } },
        ]),
      ],
    ]);

    await harness.page.getByTestId('pick-file-before').click();
    await harness.page.getByTestId('pick-file-after').click();
    await expect(harness.page.getByTestId('detected-bar')).toContainText('API diff');
    await harness.page.getByTestId('compare-button').click();

    const view = harness.page.getByTestId('api-view');
    await expect(view).toBeVisible({ timeout: 20_000 });

    const strip = harness.page.getByTestId('summary-strip');
    // /retired gone, /new arrived, /v1/orders changed, /v1/health untouched.
    await expect(strip).toContainText('－1 removed');
    await expect(strip).toContainText('＋1 added');
    // /v1/orders is the only entry present on both sides that changed.
    await expect(strip).toContainText('～1 modified');
    await expect(strip).toContainText('4 entries');
    // Only /v1/orders carries headers: its `date` changed and was suppressed, its
    // `cache-control` changed and was not.
    await expect(strip).toContainText('1 suppressed');
    // The changed `total` counts as a body change — `changed` belongs in that total
    // as much as an added or removed field does.
    await expect(strip).toContainText('1 body changes');

    // The query *values* differ and the entry still paired — pairing on the raw URL
    // would have reported it as one removal plus one addition.
    const orders = view.locator('[data-testid="api-entry-GET /v1/orders?page,t"]');
    await expect(orders).toHaveCount(1);
    await expect(orders).toHaveAttribute('data-verdict', 'changed');

    // Expanding shows the body change and the header change, and not the date.
    await orders.locator('.dd-apihead').click();
    await expect(orders).toContainText('cache-control');
    await expect(orders).not.toContainText('date');
    await expect(orders).toContainText('$.items[0].total');

    await harness.screenshot('api-har');

    expect(harness.errors, `errors:\n${harness.errors.join('\n')}`).toEqual([]);
  } finally {
    if (root !== null) await rm(root, { recursive: true, force: true });
    await harness.close();
  }
});
