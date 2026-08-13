/**
 * Reading the three config shapes (v0.3.7).
 *
 * All three flatten to the same thing — `path → value` — which is what lets one row
 * model, one masking pass and one view serve `.env`, Kubernetes and Terraform. What
 * differs is only how the keys are arrived at.
 */

export type ConfigKind = 'env' | 'k8s' | 'tfvars' | 'tfplan';

export interface ConfigEntry {
  /** `DATABASE_URL`, or `Deployment/api.spec.replicas`. */
  key: string;
  value: string;
  /** True for a key that is present with an empty value — not the same as absent. */
  empty: boolean;
  /** Set when the value was base64 in the source (a K8s Secret). */
  decoded?: boolean;
}

/** True for a `.env`-shaped file, by name. */
export function isEnvName(name: string): boolean {
  const base = name.toLowerCase().split('/').pop() ?? '';
  return base === '.env' || base.startsWith('.env.') || base.endsWith('.env');
}

export function isTfvarsName(name: string): boolean {
  const base = name.toLowerCase();
  return base.endsWith('.tfvars') || base.endsWith('.tfvars.json');
}

/**
 * A `.env` parser.
 *
 * Its own, and small, because the format is small: `KEY=value`, an optional
 * `export`, `#` comments, single or double quotes, and a quoted value that may
 * contain newlines. What it deliberately does *not* do is expand `${OTHER}` — an
 * environment file is being compared, not executed, and resolving a variable against
 * the *reader's* environment would make the diff depend on who opened it.
 */
export function parseEnv(text: string): ConfigEntry[] {
  const entries: ConfigEntry[] = [];
  const lines = text.replace(/\r\n/g, '\n').split('\n');

  for (let at = 0; at < lines.length; at += 1) {
    const line = lines[at] as string;
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;

    const withoutExport = trimmed.replace(/^export\s+/, '');
    const equals = withoutExport.indexOf('=');
    if (equals <= 0) continue;

    const key = withoutExport.slice(0, equals).trim();
    let raw = withoutExport.slice(equals + 1);

    const quote = raw.startsWith('"') ? '"' : raw.startsWith("'") ? "'" : '';
    if (quote !== '') {
      raw = raw.slice(1);
      // A quoted value may run over several lines; keep consuming until it closes.
      while (!endsQuoted(raw, quote) && at + 1 < lines.length) {
        at += 1;
        raw += `\n${lines[at] as string}`;
      }
      const close = raw.lastIndexOf(quote);
      raw = close === -1 ? raw : raw.slice(0, close);
      if (quote === '"') raw = raw.replace(/\\n/g, '\n').replace(/\\"/g, '"');
    } else {
      // An unquoted value ends at a comment, per every dotenv implementation.
      const comment = raw.indexOf(' #');
      if (comment !== -1) raw = raw.slice(0, comment);
      raw = raw.trim();
    }

    entries.push({ key, value: raw, empty: raw === '' });
  }

  return entries;
}

function endsQuoted(value: string, quote: string): boolean {
  if (!value.endsWith(quote)) return false;
  // `a\"` is an escaped quote, not the end of the value.
  let backslashes = 0;
  for (let at = value.length - 2; at >= 0 && value[at] === '\\'; at -= 1) backslashes += 1;
  return backslashes % 2 === 0;
}

function isBase64(value: string): boolean {
  return value.length >= 4 && value.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(value);
}

/** True for text with control bytes in it — a decoded TLS key, not a string. */
function hasControlBytes(value: string): boolean {
  // A char-code loop rather than a regex: a character class of control characters
  // trips eslint's `no-control-regex`, and rightly — the escapes are unreadable and
  // the literal form is invisible.
  for (let at = 0; at < value.length; at += 1) {
    const code = value.charCodeAt(at);
    if (code < 9 || (code > 13 && code < 32)) return true;
  }
  return false;
}

/** Decodes base64 without a host: `atob` is a JS global in node and the browser. */
function fromBase64(value: string): string | null {
  try {
    const decoded = atob(value);
    return hasControlBytes(decoded) ? null : decoded;
  } catch {
    return null;
  }
}

/**
 * Flattens a parsed YAML/JSON document tree into `a.b[0].c` entries.
 *
 * Arrays keep their index, except where the caller has already keyed them by
 * identity (K8s containers, below) — an index is a poor key for a list whose order
 * carries no meaning, and a lie for one whose order does.
 */
export function flattenTree(value: unknown, prefix: string, into: ConfigEntry[], depth = 0): void {
  if (depth > 40) return;

  if (Array.isArray(value)) {
    value.forEach((item, index) => flattenTree(item, `${prefix}[${index}]`, into, depth + 1));
    return;
  }

  if (typeof value === 'object' && value !== null) {
    for (const [key, child] of Object.entries(value)) {
      flattenTree(child, prefix === '' ? key : `${prefix}.${key}`, into, depth + 1);
    }
    return;
  }

  const text = value === null ? '' : String(value);
  into.push({ key: prefix, value: text, empty: text === '' });
}

/**
 * One Kubernetes document → entries keyed by `Kind/name`.
 *
 * Keying on kind and name rather than on document position is the whole reason this
 * function exists: two clusters, or two `kustomize build` runs, never emit their
 * objects in the same order, and comparing document 3 against document 3 would report
 * a Deployment against a Service.
 */
export function flattenK8s(document: unknown, into: ConfigEntry[]): void {
  if (typeof document !== 'object' || document === null) return;
  const object = document as Record<string, unknown>;
  const kind = String(object['kind'] ?? 'Object');
  const metadata = (object['metadata'] ?? {}) as Record<string, unknown>;
  const name = String(metadata['name'] ?? '(unnamed)');
  const namespace = metadata['namespace'] === undefined ? '' : `${String(metadata['namespace'])}/`;
  const prefix = `${kind}/${namespace}${name}`;

  const rest: Record<string, unknown> = { ...object };
  delete rest['apiVersion'];
  delete rest['kind'];

  const staged: ConfigEntry[] = [];
  flattenTree(rest, prefix, staged);

  for (const entry of staged) {
    // A Secret's values are base64 in the file. Two Secrets that differ only in
    // padding hold the same secret, and the reader needs to know *that* rather than
    // that two base64 blobs differ — so decode, then let masking re-hide it.
    const inSecretData = kind === 'Secret' && /\.(data|stringData)\./.test(entry.key);
    if (!inSecretData || !isBase64(entry.value)) {
      into.push(entry);
      continue;
    }
    const decoded = fromBase64(entry.value);
    if (decoded === null) into.push(entry);
    else into.push({ ...entry, value: decoded, empty: decoded === '', decoded: true });
  }
}

/**
 * A Terraform *plan* in JSON (`terraform show -json plan.out`).
 *
 * `planned_values.root_module` is the shape of the environment after apply, which is
 * the thing worth comparing. HCL is deliberately not parsed: it needs a real parser,
 * and a `.tf` file describes how an environment is built rather than what it is.
 */
export function flattenPlan(document: unknown, into: ConfigEntry[]): void {
  const root = (document ?? {}) as Record<string, unknown>;
  const planned = (root['planned_values'] ?? {}) as Record<string, unknown>;
  const module = (planned['root_module'] ?? {}) as Record<string, unknown>;
  const resources = Array.isArray(module['resources']) ? module['resources'] : [];

  for (const raw of resources) {
    const resource = (raw ?? {}) as Record<string, unknown>;
    const address = String(resource['address'] ?? 'resource');
    flattenTree(resource['values'] ?? {}, address, into);
  }

  const outputs = (planned['outputs'] ?? root['output_changes'] ?? {}) as Record<string, unknown>;
  flattenTree(outputs, 'output', into);
}

/** True for a Terraform plan, from a possibly truncated head. */
export function looksLikePlan(text: string): boolean {
  const head = text.slice(0, 4096);
  return /"terraform_version"\s*:/.test(head) || /"planned_values"\s*:/.test(head);
}

/** True for a Kubernetes manifest, from a possibly truncated head. */
export function looksLikeK8s(text: string): boolean {
  const head = text.slice(0, 4096);
  return /^\s*apiVersion\s*:/m.test(head) && /^\s*kind\s*:/m.test(head);
}
