import { describe, expect, it, vi } from 'vitest';
import { apiEngine, apiShapeOf, DEFAULT_API_OPTIONS, type ApiDiffData } from './index';
import { compareContracts, parseContract } from './contract';
import { keyOf, pairEntries, parseHar } from './har';
import { detectKind } from '../detect';
import type { EngineCtx, InputRef } from '../types';

/** A minimal but real HAR: one log, entries with request and response. */
function har(
  entries: Array<{
    method?: string;
    url: string;
    status?: number;
    body?: unknown;
    headers?: Record<string, string>;
  }>,
): string {
  return JSON.stringify({
    log: {
      version: '1.2',
      creator: { name: 'test', version: '1' },
      entries: entries.map((entry) => ({
        startedDateTime: '2026-08-13T00:00:00.000Z',
        request: { method: entry.method ?? 'GET', url: entry.url, headers: [] },
        response: {
          status: entry.status ?? 200,
          statusText: 'OK',
          headers: Object.entries(entry.headers ?? {}).map(([name, value]) => ({ name, value })),
          content: {
            mimeType: 'application/json',
            text: entry.body === undefined ? undefined : JSON.stringify(entry.body),
          },
        },
      })),
    },
  });
}

function contract(paths: Record<string, unknown>, components?: Record<string, unknown>): string {
  return JSON.stringify({
    openapi: '3.0.3',
    info: { title: 'test', version: '1' },
    paths,
    ...(components !== undefined ? { components: { schemas: components } } : {}),
  });
}

function jsonBody(schema: unknown): unknown {
  return { content: { 'application/json': { schema } } };
}

function ctx(): EngineCtx {
  return { signal: new AbortController().signal, progress: vi.fn() };
}

function ref(side: 'A' | 'B', name: string, text: string): InputRef {
  return { side, kind: 'api', name, text, size: text.length };
}

async function run(beforeText: string, afterText: string, options = {}) {
  const result = await apiEngine.compare(
    ref('A', 'before', beforeText),
    ref('B', 'after', afterText),
    { ...apiEngine.defaultOptions(), ...options },
    ctx(),
  );
  return { result, data: result.data as ApiDiffData };
}

describe('detection', () => {
  it('claims a HAR and an OpenAPI document, and nothing else', () => {
    expect(apiShapeOf(har([{ url: 'https://x/y' }]))).toBe('har');
    expect(apiShapeOf(contract({}))).toBe('contract');
    expect(apiShapeOf('{"user":{"id":1}}')).toBeNull();
    expect(apiShapeOf(undefined)).toBeNull();
  });

  it('recognises a HAR from a truncated head, which is all main sniffs', () => {
    // `readInput` reads 8 KB; a real HAR is megabytes, so the tell has to be near
    // the top and must not need the document to parse.
    const head = har([{ url: 'https://x/y' }]).slice(0, 120);
    expect(() => JSON.parse(head)).toThrow();
    expect(apiShapeOf(head)).toBe('har');
  });

  it('routes a .json HAR to the api kind, before the extension map', () => {
    expect(
      detectKind({ name: 'session.json', text: har([{ url: 'https://x/y' }]), kind: 'unknown' }),
    ).toBe('api');
    // Two ordinary JSON documents stay JSON — the API engine is a choice for those.
    expect(detectKind({ name: 'user.json', text: '{"id":1}', kind: 'unknown' })).toBe('json');
  });
});

describe('HAR pairing', () => {
  it('keys on method and path with query names, not values', () => {
    expect(keyOf('get', 'https://api.test/v1/orders?page=2&t=1699')).toBe('GET /v1/orders?page,t');
    // The same request twice with a different cache-buster is the same request.
    expect(keyOf('GET', 'https://api.test/v1/orders?t=1700&page=2')).toBe('GET /v1/orders?page,t');
  });

  it('pairs repeats in order and leaves the extra one unpaired', () => {
    const before = parseHar(har([{ url: '/a' }, { url: '/a' }, { url: '/b' }]));
    const after = parseHar(har([{ url: '/a' }, { url: '/b' }]));
    const pairs = pairEntries(before, after);

    expect(pairs).toHaveLength(3);
    expect(pairs.filter((pair) => pair.after === undefined)).toHaveLength(1);
  });

  it('lower-cases header names, which two captures never agree on', () => {
    const entries = parseHar(har([{ url: '/a', headers: { 'X-Request-Id': 'abc' } }]));
    expect(entries[0]?.responseHeaders[0]?.name).toBe('x-request-id');
  });
});

describe('apiEngine over two captures', () => {
  it('reports a status regression as breaking', async () => {
    const { data, result } = await run(
      har([{ url: '/v1/orders', status: 200, body: { ok: true } }]),
      har([{ url: '/v1/orders', status: 500, body: { error: 'boom' } }]),
    );
    expect(data.entries[0]?.verdict).toBe('breaking');
    expect(result.summary.extra?.['breaking']).toBe(1);
  });

  it('reports an entry that stopped being served as breaking', async () => {
    const { data } = await run(
      har([{ url: '/v1/gone' }, { url: '/v1/kept' }]),
      har([{ url: '/v1/kept' }]),
    );
    const gone = data.entries.find((entry) => entry.path.includes('gone'));
    expect(gone?.presence).toBe('before-only');
    expect(gone?.verdict).toBe('breaking');
  });

  it('suppresses volatile headers and counts them (Rule 3)', async () => {
    const { result, data } = await run(
      har([
        {
          url: '/v1/x',
          headers: { date: 'Mon', 'x-request-id': 'a', 'cache-control': 'no-store' },
        },
      ]),
      har([
        {
          url: '/v1/x',
          headers: { date: 'Tue', 'x-request-id': 'b', 'cache-control': 'max-age=60' },
        },
      ]),
    );
    expect(result.summary.suppressed).toBe(2);
    expect(data.entries[0]?.headers.changed.map((header) => header.name)).toEqual([
      'cache-control',
    ]);
    expect(result.normalizationNotes.join(' ')).toMatch(/volatile headers/i);
  });

  it('compares bodies structurally, so a reordered key is not a change', async () => {
    const { data } = await run(
      har([{ url: '/v1/x', body: { a: 1, b: 2 } }]),
      har([{ url: '/v1/x', body: { b: 2, a: 1 } }]),
    );
    expect(data.entries[0]?.verdict).toBe('unchanged');
  });

  it('says so when a body is not JSON rather than pretending to compare it', async () => {
    const notJson = JSON.parse(har([{ url: '/v1/x' }])) as {
      log: { entries: Array<{ response: { content: { text?: string } } }> };
    };
    notJson.log.entries[0]!.response.content.text = '<html>one</html>';
    const other = JSON.parse(har([{ url: '/v1/x' }])) as typeof notJson;
    other.log.entries[0]!.response.content.text = '<html>two</html>';

    const { data } = await run(JSON.stringify(notJson), JSON.stringify(other));
    expect(data.entries[0]?.bodyNote).toMatch(/not JSON/);
    expect(data.entries[0]?.verdict).toBe('changed');
  });

  it('refuses a HAR against a contract, and offers JSON', async () => {
    await expect(
      apiEngine.compare(
        ref('A', 'a.har', har([{ url: '/x' }])),
        ref('B', 'openapi.json', contract({})),
        apiEngine.defaultOptions(),
        ctx(),
      ),
    ).rejects.toMatchObject({ name: 'EngineInputError', fallback: { fallbackEngineId: 'json' } });
  });
});

describe('contract comparison', () => {
  const base = {
    '/orders': {
      get: {
        responses: {
          '200': jsonBody({
            type: 'object',
            properties: { id: { type: 'string' }, total: { type: 'number' } },
          }),
        },
      },
      post: {
        requestBody: jsonBody({
          type: 'object',
          required: ['item'],
          properties: { item: { type: 'string' }, note: { type: 'string' } },
        }),
        responses: { '201': jsonBody({ type: 'object', properties: { id: { type: 'string' } } }) },
      },
    },
  };

  const findings = (after: Record<string, unknown>) =>
    compareContracts(
      parseContract(JSON.parse(contract(base))),
      parseContract(JSON.parse(contract(after))),
    );

  it('calls a removed operation breaking', () => {
    const { '/orders': orders } = base;
    const { get: _dropped, ...rest } = orders as Record<string, unknown>;
    const result = findings({ '/orders': rest });
    expect(result[0]).toMatchObject({ verdict: 'breaking', rule: 'operation-removed' });
  });

  it('calls a removed response field breaking and an added one compatible', () => {
    const result = findings({
      ...base,
      '/orders': {
        ...base['/orders'],
        get: {
          responses: {
            '200': jsonBody({
              type: 'object',
              properties: { id: { type: 'string' }, currency: { type: 'string' } },
            }),
          },
        },
      },
    });
    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ rule: 'response-field-removed', verdict: 'breaking' }),
        expect.objectContaining({ rule: 'response-field-added', verdict: 'compatible' }),
      ]),
    );
  });

  it('calls a newly required request field breaking', () => {
    const result = findings({
      ...base,
      '/orders': {
        ...base['/orders'],
        post: {
          requestBody: jsonBody({
            type: 'object',
            required: ['item', 'note'],
            properties: { item: { type: 'string' }, note: { type: 'string' } },
          }),
          responses: base['/orders'].post.responses,
        },
      },
    });
    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ rule: 'request-field-now-required', verdict: 'breaking' }),
      ]),
    );
  });

  it('calls a narrowed type breaking, whichever direction it is', () => {
    const result = findings({
      ...base,
      '/orders': {
        ...base['/orders'],
        get: {
          responses: {
            '200': jsonBody({
              type: 'object',
              properties: { id: { type: 'string' }, total: { type: 'string' } },
            }),
          },
        },
      },
    });
    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rule: 'type-changed',
          verdict: 'breaking',
          detail: 'number → string.',
        }),
      ]),
    );
  });

  it('resolves a local $ref, and survives a cyclic one', () => {
    const withRef = contract(
      {
        '/tree': { get: { responses: { '200': jsonBody({ $ref: '#/components/schemas/Node' }) } } },
      },
      {
        Node: {
          type: 'object',
          properties: { name: { type: 'string' }, child: { $ref: '#/components/schemas/Node' } },
        },
      },
    );
    const parsed = parseContract(JSON.parse(withRef));
    const response = parsed.operations.get('GET /tree')?.response;
    expect(response?.get('name')?.type).toBe('string');
    // The cycle terminates rather than recursing until the stack gives out.
    expect(response?.has('child')).toBe(true);
  });

  it('sorts breaking findings first', () => {
    const result = findings({
      '/orders': {
        post: base['/orders'].post,
        // get removed → breaking; /new added → compatible.
      },
      '/new': { get: { responses: { '200': jsonBody({ type: 'object' }) } } },
    });
    expect(result[0]?.verdict).toBe('breaking');
    expect(result[result.length - 1]?.verdict).toBe('compatible');
  });

  it('scores three radar axes and leaves the rest absent', async () => {
    const { result } = await run(contract(base), contract({ ...base, '/extra': base['/orders'] }));
    expect(Object.keys(result.summary.radar ?? {}).sort()).toEqual([
      'content',
      'metadata',
      'structure',
    ]);
  });

  it('does not fetch anything, and says the responses have no status', async () => {
    // A `response` pair: two saved bodies. There is no status or header in a saved
    // body, and inventing a 200 would be a fact the file does not contain.
    const { data, result } = await run('{"items":[{"id":1}]}', '{"items":[{"id":2}]}');
    expect(data.mode).toBe('response');
    expect(data.entries[0]?.status).toEqual({ before: 0, after: 0 });
    expect(result.normalizationNotes.join(' ')).toMatch(/no status and no headers/);
  });
});

it('uses the default volatile header list, copied not shared', () => {
  // `defaultOptions()` has to hand back a fresh array, or a view mutating it would
  // change the defaults for every later comparison.
  const first = apiEngine.defaultOptions();
  first.volatileHeaders.push('x-mine');
  expect(apiEngine.defaultOptions().volatileHeaders).toEqual(DEFAULT_API_OPTIONS.volatileHeaders);
});
