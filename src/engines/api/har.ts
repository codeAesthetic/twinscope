/**
 * HAR parsing and entry pairing (v0.3.1, MD §17).
 *
 * A HAR is a recording of a session, and two recordings of the *same* session
 * never agree on much: timestamps differ, cookies differ, and the order of
 * concurrent requests is whatever the browser felt like. So the interesting work
 * here is not reading the format — it is **pairing** entries so that a diff
 * describes what changed about the API rather than what changed about the capture.
 *
 * Entries pair on `METHOD + path`, with the query string reduced to its sorted key
 * names: `?page=2&t=1699` and `?t=1700&page=2` are the same request twice, and
 * pairing them on the raw URL would report every request as removed-and-added.
 * Repeated calls to one key pair in order of occurrence.
 */

export interface HarHeader {
  name: string;
  value: string;
}

export interface HarEntry {
  method: string;
  url: string;
  /** `GET /v1/orders?page,sort` — what pairing is done on. */
  key: string;
  status: number;
  statusText: string;
  requestHeaders: HarHeader[];
  responseHeaders: HarHeader[];
  requestBody: string | undefined;
  responseBody: string | undefined;
  mimeType: string | undefined;
}

export interface HarPair {
  key: string;
  before: HarEntry | undefined;
  after: HarEntry | undefined;
}

/** True for a document that is a HAR, judged from a *possibly truncated* head. */
export function looksLikeHar(text: string): boolean {
  const head = text.slice(0, 4096);
  return /"log"\s*:/.test(head) && /"entries"\s*:/.test(head);
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function headersOf(value: unknown): HarHeader[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => asRecord(entry))
    .filter((entry) => typeof entry['name'] === 'string')
    .map((entry) => ({
      // Header names are case-insensitive by definition, and two captures rarely
      // agree on the casing. Lower-cased here so everything downstream can compare
      // them as strings.
      name: String(entry['name']).toLowerCase(),
      value: String(entry['value'] ?? ''),
    }));
}

/** `GET /v1/orders?page,sort` — path plus the *names* of its query parameters. */
export function keyOf(method: string, rawUrl: string): string {
  let path = rawUrl;
  let query = '';
  try {
    // A HAR url is absolute, but a hand-made fixture may not be.
    const url = new URL(rawUrl, 'http://placeholder.invalid');
    path = url.pathname;
    const names = [...new Set([...url.searchParams.keys()])].sort();
    query = names.length === 0 ? '' : `?${names.join(',')}`;
  } catch {
    const cut = rawUrl.indexOf('?');
    if (cut !== -1) path = rawUrl.slice(0, cut);
  }
  return `${method.toUpperCase()} ${path}${query}`;
}

export function parseHar(text: string): HarEntry[] {
  const document = asRecord(JSON.parse(text));
  const log = asRecord(document['log']);
  const entries = Array.isArray(log['entries']) ? log['entries'] : [];

  return entries.map((raw) => {
    const entry = asRecord(raw);
    const request = asRecord(entry['request']);
    const response = asRecord(entry['response']);
    const content = asRecord(response['content']);
    const postData = asRecord(request['postData']);

    const method = String(request['method'] ?? 'GET').toUpperCase();
    const url = String(request['url'] ?? '');
    const bodyText = content['text'];
    const requestText = postData['text'];

    return {
      method,
      url,
      key: keyOf(method, url),
      status: Number(response['status'] ?? 0),
      statusText: String(response['statusText'] ?? ''),
      requestHeaders: headersOf(request['headers']),
      responseHeaders: headersOf(response['headers']),
      requestBody: typeof requestText === 'string' ? requestText : undefined,
      responseBody: typeof bodyText === 'string' ? bodyText : undefined,
      mimeType: typeof content['mimeType'] === 'string' ? content['mimeType'] : undefined,
    };
  });
}

/**
 * Pairs two sets of entries by key, preserving the order of repeats.
 *
 * A key seen three times before and twice after yields three pairs, the last with
 * no `after` — which is the honest reading: one of the three calls stopped
 * happening, and which one is not knowable from a capture.
 */
export function pairEntries(before: readonly HarEntry[], after: readonly HarEntry[]): HarPair[] {
  const byKey = new Map<string, { before: HarEntry[]; after: HarEntry[] }>();

  const bucket = (key: string): { before: HarEntry[]; after: HarEntry[] } => {
    const existing = byKey.get(key);
    if (existing !== undefined) return existing;
    const created = { before: [] as HarEntry[], after: [] as HarEntry[] };
    byKey.set(key, created);
    return created;
  };

  for (const entry of before) bucket(entry.key).before.push(entry);
  for (const entry of after) bucket(entry.key).after.push(entry);

  const pairs: HarPair[] = [];
  for (const [key, group] of byKey) {
    const count = Math.max(group.before.length, group.after.length);
    for (let at = 0; at < count; at += 1) {
      pairs.push({ key, before: group.before[at], after: group.after[at] });
    }
  }
  return pairs;
}
