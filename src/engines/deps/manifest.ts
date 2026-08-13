import { parseYaml } from '../yaml/yamlDiff';

/**
 * Reading a manifest or a lockfile into one shape (v0.2.10).
 *
 * Four file formats, three package managers, one question: which packages at which
 * versions. Everything format-specific stops here.
 */

export type DepKind = 'prod' | 'dev' | 'peer' | 'optional';

export type SourceKind = 'manifest' | 'npm-lock' | 'pnpm-lock' | 'yarn-lock' | 'unknown';

export interface DeclaredDep {
  name: string;
  /** The range as written (`^1.2.3`), or the resolved version from a lockfile. */
  version: string;
  kind: DepKind;
  /** Only npm lockfiles record this. */
  license?: string;
}

export interface DepSource {
  kind: SourceKind;
  /** Direct dependencies: what the project asked for. */
  direct: DeclaredDep[];
  /** Everything the lockfile resolved, direct and transitive, by name. */
  resolved: Map<string, { version: string; license?: string }>;
  /** Package name from a manifest, for the header. */
  project?: string;
}

/** Recognised by *filename*, since all four are `.json` or `.yaml` by extension. */
export function sourceKindFor(name: string): SourceKind {
  const base = name.toLowerCase().split('/').pop() ?? '';
  if (base === 'package.json') return 'manifest';
  if (base === 'package-lock.json' || base === 'npm-shrinkwrap.json') return 'npm-lock';
  if (base === 'pnpm-lock.yaml' || base === 'pnpm-lock.yml') return 'pnpm-lock';
  if (base === 'yarn.lock') return 'yarn-lock';
  return 'unknown';
}

export function isDependencyFile(name: string): boolean {
  return sourceKindFor(name) !== 'unknown';
}

const FIELD_KIND: Array<[string, DepKind]> = [
  ['dependencies', 'prod'],
  ['devDependencies', 'dev'],
  ['peerDependencies', 'peer'],
  ['optionalDependencies', 'optional'],
];

export class DepParseError extends Error {}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function readManifest(text: string, label: string): DepSource {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    throw new DepParseError(
      `${label} is not valid JSON — ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }

  const root = asRecord(parsed);
  const direct: DeclaredDep[] = [];

  for (const [field, kind] of FIELD_KIND) {
    for (const [name, range] of Object.entries(asRecord(root[field]))) {
      if (typeof range === 'string') direct.push({ name, version: range, kind });
    }
  }

  const project = typeof root['name'] === 'string' ? root['name'] : undefined;
  return {
    kind: 'manifest',
    direct,
    resolved: new Map(),
    ...(project !== undefined ? { project } : {}),
  };
}

/**
 * npm lockfile v2/v3.
 *
 * `packages` keys are paths (`node_modules/foo`, `node_modules/a/node_modules/b`),
 * and the root project is the empty key — which is where its *direct* dependencies
 * live, so a lockfile alone still knows what was asked for.
 */
function readNpmLock(text: string, label: string): DepSource {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    throw new DepParseError(
      `${label} is not valid JSON — ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }

  const root = asRecord(parsed);
  const packages = asRecord(root['packages']);
  const resolved = new Map<string, { version: string; license?: string }>();

  for (const [path, entry] of Object.entries(packages)) {
    if (path === '') continue;
    const record = asRecord(entry);
    const version = typeof record['version'] === 'string' ? record['version'] : '';
    const license = typeof record['license'] === 'string' ? record['license'] : undefined;
    // The last `node_modules/` segment is the package name; anything before it is
    // the nesting that got it there.
    const name = path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length);
    if (name === '') continue;
    resolved.set(name, { version, ...(license !== undefined ? { license } : {}) });
  }

  const project = asRecord(packages['']);
  const direct: DeclaredDep[] = [];
  for (const [field, kind] of FIELD_KIND) {
    for (const [name, range] of Object.entries(asRecord(project[field]))) {
      if (typeof range === 'string') {
        const found = resolved.get(name);
        direct.push({
          name,
          // Prefer the resolved version: it is what is actually installed.
          version: found?.version !== undefined && found.version !== '' ? found.version : range,
          kind,
          ...(found?.license !== undefined ? { license: found.license } : {}),
        });
      }
    }
  }

  const name = typeof root['name'] === 'string' ? root['name'] : undefined;
  return { kind: 'npm-lock', direct, resolved, ...(name !== undefined ? { project: name } : {}) };
}

/**
 * pnpm lockfile. YAML, so the v0.2.3 parser reads it.
 *
 * Keys under `packages:` are `/name@version` (v6+) or `/name/version` (v5), and
 * `importers` holds the direct dependencies per workspace package. No licences —
 * pnpm does not record them, which is why the note has to say so.
 */
function readPnpmLock(text: string, label: string): DepSource {
  let value: unknown;
  try {
    value = parseYaml(text, label).value;
  } catch (cause) {
    throw new DepParseError(cause instanceof Error ? cause.message : String(cause));
  }

  const root = asRecord(value);
  const resolved = new Map<string, { version: string }>();

  for (const key of Object.keys(asRecord(root['packages']))) {
    const trimmed = key.startsWith('/') ? key.slice(1) : key;
    // `@scope/name@1.2.3` — the version is after the LAST `@`, which is not the
    // scope's. `@scope/name/1.2.3` is the older shape.
    const at = trimmed.lastIndexOf('@');
    if (at > 0) {
      resolved.set(trimmed.slice(0, at), { version: trimmed.slice(at + 1) });
      continue;
    }
    const slash = trimmed.lastIndexOf('/');
    if (slash > 0) resolved.set(trimmed.slice(0, slash), { version: trimmed.slice(slash + 1) });
  }

  const direct: DeclaredDep[] = [];
  const importers = asRecord(root['importers']);
  // A single-package repo has one importer, `.`; a workspace has several. Both are
  // read, and a name appearing twice keeps its first version.
  const sources = Object.keys(importers).length > 0 ? Object.values(importers) : [root];
  const seen = new Set<string>();

  for (const source of sources) {
    const record = asRecord(source);
    for (const [field, kind] of [
      ['dependencies', 'prod'],
      ['devDependencies', 'dev'],
      ['optionalDependencies', 'optional'],
    ] as Array<[string, DepKind]>) {
      for (const [name, entry] of Object.entries(asRecord(record[field]))) {
        if (seen.has(name)) continue;
        seen.add(name);
        const detail = asRecord(entry);
        const version =
          typeof detail['version'] === 'string'
            ? detail['version']
            : typeof entry === 'string'
              ? entry
              : (resolved.get(name)?.version ?? '');
        direct.push({ name, version, kind });
      }
    }
  }

  return { kind: 'pnpm-lock', direct, resolved };
}

/**
 * Classic `yarn.lock`. Not YAML, not JSON — its own two-space-indented format.
 *
 * Only the entry headers and their `version` lines are needed, so this is a line
 * scan rather than a parser. Berry (yarn 2+) writes YAML with a `__metadata` block;
 * that shape falls out of the same scan because its keys are also `name@range:`.
 */
function readYarnLock(text: string): DepSource {
  const resolved = new Map<string, { version: string }>();
  let pending: string[] = [];

  for (const line of text.split('\n')) {
    if (line.trim() === '' || line.startsWith('#')) continue;

    if (!line.startsWith(' ')) {
      // An entry header: one or more `name@range` specifiers, comma-separated.
      pending = line
        .replace(/:$/, '')
        .split(',')
        .map((part) => part.trim().replace(/^"|"$/g, ''))
        .map((spec) => {
          const at = spec.lastIndexOf('@');
          return at > 0 ? spec.slice(0, at) : spec;
        })
        .filter((name) => name !== '' && name !== '__metadata');
      continue;
    }

    const version = /^\s+"?version"?:?\s+"?([^"\s]+)"?/.exec(line);
    if (version !== null && pending.length > 0) {
      for (const name of pending) resolved.set(name, { version: version[1] as string });
      pending = [];
    }
  }

  // A classic yarn.lock does not distinguish direct from transitive, so everything
  // it resolved is offered as direct — and the note says the distinction is lost.
  const direct: DeclaredDep[] = [...resolved.entries()].map(([name, entry]) => ({
    name,
    version: entry.version,
    kind: 'prod' as DepKind,
  }));

  return { kind: 'yarn-lock', direct, resolved };
}

export function readDepSource(name: string, text: string): DepSource {
  const kind = sourceKindFor(name);
  if (kind === 'manifest') return readManifest(text, name);
  if (kind === 'npm-lock') return readNpmLock(text, name);
  if (kind === 'pnpm-lock') return readPnpmLock(text, name);
  if (kind === 'yarn-lock') return readYarnLock(text);
  throw new DepParseError(`${name} is not a manifest or a lockfile.`);
}

/** How a source reads in a note or a header. */
export function sourceLabel(kind: SourceKind): string {
  if (kind === 'manifest') return 'package.json';
  if (kind === 'npm-lock') return 'npm lockfile';
  if (kind === 'pnpm-lock') return 'pnpm lockfile';
  if (kind === 'yarn-lock') return 'yarn.lock';
  return 'unknown';
}
