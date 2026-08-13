/**
 * Breaking-change detection over two OpenAPI documents (v0.3.1, MD §17).
 *
 * This is the part of an API diff that answers the question people actually have:
 * *will a consumer break?* A structural diff of two OpenAPI files reports that a
 * `required` array gained an entry; a contract diff reports that clients sending
 * that request now fail validation. Same bytes, different answer.
 *
 * Every rule is **named in its finding**, because a verdict nobody can audit is a
 * guess with a badge on it. The rules are deliberately conservative: where
 * compatibility depends on something the document does not say — a default that
 * consumers may or may not rely on — the change is reported as notable rather than
 * asserted as safe.
 */

export type Verdict = 'breaking' | 'compatible';

export interface ApiFinding {
  verdict: Verdict;
  /** The rule that fired, e.g. `response-field-removed`. */
  rule: string;
  /** Where: `GET /orders` or `GET /orders → response.items[].total`. */
  where: string;
  detail: string;
}

interface SchemaFact {
  type: string;
  required: boolean;
  enum?: string[];
}

/** A parsed contract, reduced to what compatibility depends on. */
export interface Contract {
  version: string;
  /** `GET /orders` → the operation's request and response shapes. */
  operations: Map<string, { request: Map<string, SchemaFact>; response: Map<string, SchemaFact> }>;
}

const METHODS = ['get', 'put', 'post', 'delete', 'patch', 'head', 'options', 'trace'];

/** Nesting past this is a document defending itself against being read. */
const MAX_DEPTH = 12;

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** True for an OpenAPI or Swagger document, from a possibly truncated head. */
export function looksLikeContract(text: string): boolean {
  const head = text.slice(0, 2048);
  return /["']?(openapi|swagger)["']?\s*:\s*["']?[23]/.test(head);
}

/**
 * Resolves a local `$ref`.
 *
 * Only same-document refs: an external `$ref` names a file this engine was not
 * given, and following one would mean reading a path the user did not choose.
 * Unresolvable refs degrade to an unknown type rather than throwing — half a
 * contract read is still worth more than a parse error.
 */
function resolveRef(document: Record<string, unknown>, ref: string): Record<string, unknown> {
  if (!ref.startsWith('#/')) return {};
  let node: unknown = document;
  for (const segment of ref.slice(2).split('/')) {
    node = asRecord(node)[segment.replace(/~1/g, '/').replace(/~0/g, '~')];
    if (node === undefined) return {};
  }
  return asRecord(node);
}

function deref(
  document: Record<string, unknown>,
  schema: Record<string, unknown>,
  seen: ReadonlySet<string>,
): { schema: Record<string, unknown>; seen: ReadonlySet<string> } {
  const ref = schema['$ref'];
  if (typeof ref !== 'string') return { schema, seen };
  // A cycle is legal in OpenAPI (a tree node with children of its own type) and
  // fatal to a naive walk.
  if (seen.has(ref)) return { schema: {}, seen };
  const next = new Set(seen);
  next.add(ref);
  return deref(document, resolveRef(document, ref), next);
}

/**
 * Flattens a schema into `path → fact`, which is what makes comparison a set
 * operation rather than a recursive walk over two trees at once.
 */
function flatten(
  document: Record<string, unknown>,
  rawSchema: Record<string, unknown>,
  prefix: string,
  into: Map<string, SchemaFact>,
  depth: number,
  seen: ReadonlySet<string>,
  requiredHere = false,
): void {
  if (depth > MAX_DEPTH) return;
  const { schema, seen: nextSeen } = deref(document, rawSchema, seen);

  const type =
    typeof schema['type'] === 'string'
      ? String(schema['type'])
      : schema['properties'] !== undefined
        ? 'object'
        : schema['items'] !== undefined
          ? 'array'
          : 'unknown';

  if (prefix !== '') {
    const values = Array.isArray(schema['enum'])
      ? (schema['enum'] as unknown[]).map((value) => String(value))
      : undefined;
    into.set(prefix, {
      type,
      required: requiredHere,
      ...(values !== undefined ? { enum: values } : {}),
    });
  }

  const properties = asRecord(schema['properties']);
  const required = new Set(
    (Array.isArray(schema['required']) ? schema['required'] : []).map((name) => String(name)),
  );
  for (const [name, child] of Object.entries(properties)) {
    flatten(
      document,
      asRecord(child),
      prefix === '' ? name : `${prefix}.${name}`,
      into,
      depth + 1,
      nextSeen,
      required.has(name),
    );
  }

  const items = schema['items'];
  if (items !== undefined) {
    flatten(document, asRecord(items), `${prefix}[]`, into, depth + 1, nextSeen, false);
  }
}

function jsonSchemaOf(
  document: Record<string, unknown>,
  container: unknown,
): Record<string, unknown> {
  const content = asRecord(asRecord(container)['content']);
  // Any JSON-ish media type: `application/json`, `application/vnd.x+json`, …
  const key = Object.keys(content).find((type) => type.includes('json'));
  if (key === undefined) return {};
  return asRecord(asRecord(content[key])['schema']);
}

export function parseContract(document: unknown): Contract {
  const root = asRecord(document);
  const version = String(root['openapi'] ?? root['swagger'] ?? 'unknown');
  const paths = asRecord(root['paths']);
  const operations: Contract['operations'] = new Map();

  for (const [path, rawItem] of Object.entries(paths)) {
    const item = asRecord(rawItem);
    for (const method of METHODS) {
      const operation = item[method];
      if (operation === undefined) continue;
      const details = asRecord(operation);

      const request = new Map<string, SchemaFact>();
      flatten(root, jsonSchemaOf(root, details['requestBody']), '', request, 0, new Set());

      // Required *parameters* break a client exactly as a required body field does,
      // so they live in the same map under a `?name` key.
      for (const raw of Array.isArray(details['parameters']) ? details['parameters'] : []) {
        const parameter = asRecord(raw);
        const name = String(parameter['name'] ?? '');
        if (name === '') continue;
        const schema = asRecord(parameter['schema']);
        request.set(`${String(parameter['in'] ?? 'query')}:${name}`, {
          type: typeof schema['type'] === 'string' ? String(schema['type']) : 'unknown',
          required: parameter['required'] === true,
        });
      }

      const response = new Map<string, SchemaFact>();
      const responses = asRecord(details['responses']);
      // The success shape is the contract a consumer reads. A changed error body
      // matters less and is reported by the body diff rather than as a verdict.
      const successCode = Object.keys(responses)
        .filter((code) => /^2\d\d$/.test(code))
        .sort()[0];
      if (successCode !== undefined) {
        flatten(root, jsonSchemaOf(root, responses[successCode]), '', response, 0, new Set());
      }

      operations.set(`${method.toUpperCase()} ${path}`, { request, response });
    }
  }

  return { version, operations };
}

/**
 * Compares two contracts and returns every finding, breaking ones first.
 *
 * The rules, and why each falls where it does:
 *
 *  - an **operation removed** breaks every caller of it;
 *  - a **response field removed**, or **narrowed in type**, breaks readers;
 *  - a **request field newly required** breaks senders that omit it;
 *  - an **enum value removed from a response** breaks a consumer switching on it,
 *    and one *added to a request* is compatible while one added to a response is
 *    notable — a client with an exhaustive switch will fall through it;
 *  - anything **added** is compatible, and still reported: "compatible" is not
 *    "uninteresting", and a diff tool that hides additions teaches people to stop
 *    looking.
 */
export function compareContracts(before: Contract, after: Contract): ApiFinding[] {
  const findings: ApiFinding[] = [];

  for (const [name, operation] of before.operations) {
    const other = after.operations.get(name);
    if (other === undefined) {
      findings.push({
        verdict: 'breaking',
        rule: 'operation-removed',
        where: name,
        detail: 'This operation is gone. Every caller of it fails.',
      });
      continue;
    }

    findings.push(...compareShape(name, 'response', operation.response, other.response));
    findings.push(...compareShape(name, 'request', operation.request, other.request));
  }

  for (const name of after.operations.keys()) {
    if (before.operations.has(name)) continue;
    findings.push({
      verdict: 'compatible',
      rule: 'operation-added',
      where: name,
      detail: 'New operation.',
    });
  }

  // Breaking first, then by operation, so the report opens on what matters.
  return findings.sort((left, right) =>
    left.verdict === right.verdict
      ? left.where.localeCompare(right.where)
      : left.verdict === 'breaking'
        ? -1
        : 1,
  );
}

function compareShape(
  operation: string,
  side: 'request' | 'response',
  before: Map<string, SchemaFact>,
  after: Map<string, SchemaFact>,
): ApiFinding[] {
  const findings: ApiFinding[] = [];
  const where = (field: string): string => `${operation} → ${side}.${field}`;

  for (const [field, fact] of before) {
    const other = after.get(field);

    if (other === undefined) {
      // A response field a client reads is a promise; a request field the server
      // stops accepting is one too, but omitting it is usually the *client's*
      // choice, so it is reported as notable rather than as a break.
      findings.push(
        side === 'response'
          ? {
              verdict: 'breaking',
              rule: 'response-field-removed',
              where: where(field),
              detail: 'Clients reading this field get nothing.',
            }
          : {
              verdict: 'compatible',
              rule: 'request-field-removed',
              where: where(field),
              detail: 'No longer accepted; senders that still include it are ignored.',
            },
      );
      continue;
    }

    if (other.type !== fact.type) {
      findings.push({
        verdict: 'breaking',
        rule: 'type-changed',
        where: where(field),
        detail: `${fact.type} → ${other.type}.`,
      });
    }

    if (side === 'request' && !fact.required && other.required) {
      findings.push({
        verdict: 'breaking',
        rule: 'request-field-now-required',
        where: where(field),
        detail: 'Senders that omit it now fail validation.',
      });
    }
    if (side === 'request' && fact.required && !other.required) {
      findings.push({
        verdict: 'compatible',
        rule: 'request-field-optional',
        where: where(field),
        detail: 'No longer required.',
      });
    }

    const removed = (fact.enum ?? []).filter((value) => !(other.enum ?? []).includes(value));
    const added = (other.enum ?? []).filter((value) => !(fact.enum ?? []).includes(value));
    if (fact.enum !== undefined && other.enum !== undefined) {
      if (removed.length > 0) {
        findings.push({
          verdict: side === 'response' ? 'breaking' : 'compatible',
          rule: 'enum-value-removed',
          where: where(field),
          detail: `${removed.join(', ')} no longer possible.`,
        });
      }
      if (added.length > 0) {
        findings.push({
          verdict: side === 'response' ? 'compatible' : 'compatible',
          rule: 'enum-value-added',
          where: where(field),
          detail:
            side === 'response'
              ? `${added.join(', ')} now possible — an exhaustive switch will fall through.`
              : `${added.join(', ')} now accepted.`,
        });
      }
    }
  }

  for (const [field, fact] of after) {
    if (before.has(field)) continue;
    findings.push(
      side === 'request' && fact.required
        ? {
            verdict: 'breaking',
            rule: 'request-field-added-required',
            where: where(field),
            detail: 'A new required field. Every existing sender fails validation.',
          }
        : {
            verdict: 'compatible',
            rule: `${side}-field-added`,
            where: where(field),
            detail: fact.required ? 'New required field.' : 'New optional field.',
          },
    );
  }

  return findings;
}
