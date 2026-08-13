import { bumpBetween, bumpLabel, type Bump } from './semver';
import { readDepSource, sourceLabel, type DepKind, type DepSource } from './manifest';

/**
 * Dependency comparison (v0.2.10, A12).
 *
 * A structural diff of two `package.json` files answers the wrong question. It says
 * a string changed from `^4.17.20` to `^4.18.0`; what a reader wants is "lodash, a
 * minor bump" — and, if a lockfile is in hand, "…and 3 fewer transitive packages,
 * one of which changed licence".
 */

export type DepStatus = 'add' | 'del' | 'mod' | 'same';

export interface DepRow {
  name: string;
  kind: DepKind;
  status: DepStatus;
  /** Absent on an addition. */
  before?: string;
  /** Absent on a removal. */
  after?: string;
  /** How far the version moved, when both sides had one. */
  bump?: string;
  /** True when the AFTER version is lower — a rollback, not an upgrade. */
  downgrade?: boolean;
  licenseBefore?: string;
  licenseAfter?: string;
  /** True for a package neither side declared directly. */
  transitive?: boolean;
}

export interface DepsDiffOptions {
  /** Include packages that appear only in the lockfile's resolution. */
  includeTransitive: boolean;
  /** Compare devDependencies as well as production ones. */
  includeDev: boolean;
}

export const DEFAULT_DEPS_OPTIONS: DepsDiffOptions = {
  includeTransitive: true,
  includeDev: true,
};

export interface DepsDiffData {
  rows: DepRow[];
  source: { before: string; after: string };
  /** Everything the lockfile resolved, direct and transitive. */
  transitive: { before: number; after: number };
  /** True when both sides are lockfiles, i.e. resolved versions are real. */
  resolved: boolean;
  project: { before?: string; after?: string };
}

export interface DepsDiffStats {
  added: number;
  removed: number;
  modified: number;
  same: number;
  major: number;
  downgrades: number;
  licenseChanges: number;
}

const KIND_ORDER: DepKind[] = ['prod', 'dev', 'peer', 'optional'];

function byName(deps: DepSource['direct']): Map<string, DepSource['direct'][number]> {
  const map = new Map<string, DepSource['direct'][number]>();
  // First declaration wins: a package in both `dependencies` and
  // `devDependencies` is a mistake, but it should not produce two rows.
  for (const dep of deps) if (!map.has(dep.name)) map.set(dep.name, dep);
  return map;
}

function rowFor(
  name: string,
  kind: DepKind,
  before: string | undefined,
  after: string | undefined,
  licenses: { before?: string; after?: string },
  transitive: boolean,
): DepRow {
  const status: DepStatus =
    before === undefined ? 'add' : after === undefined ? 'del' : before === after ? 'same' : 'mod';

  const bump: Bump | null =
    status === 'mod' && before !== undefined && after !== undefined
      ? bumpBetween(before, after)
      : null;

  return {
    name,
    kind,
    status,
    ...(before !== undefined ? { before } : {}),
    ...(after !== undefined ? { after } : {}),
    ...(bump !== null ? { bump: bumpLabel(bump), downgrade: bump.downgrade } : {}),
    ...(licenses.before !== undefined ? { licenseBefore: licenses.before } : {}),
    ...(licenses.after !== undefined ? { licenseAfter: licenses.after } : {}),
    ...(transitive ? { transitive: true } : {}),
  };
}

export function diffDeps(
  beforeName: string,
  beforeText: string,
  afterName: string,
  afterText: string,
  options: DepsDiffOptions,
): { data: DepsDiffData; stats: DepsDiffStats; notes: string[] } {
  const before = readDepSource(beforeName, beforeText);
  const after = readDepSource(afterName, afterText);

  const directBefore = byName(before.direct);
  const directAfter = byName(after.direct);
  const names = new Set([...directBefore.keys(), ...directAfter.keys()]);

  const rows: DepRow[] = [];

  for (const name of names) {
    const left = directBefore.get(name);
    const right = directAfter.get(name);
    const kind = (right ?? left)?.kind ?? 'prod';
    if (!options.includeDev && kind === 'dev') continue;

    rows.push(
      rowFor(
        name,
        kind,
        left?.version,
        right?.version,
        { before: left?.license, after: right?.license },
        false,
      ),
    );
  }

  // Transitive packages: everything a lockfile resolved that nobody declared.
  const resolved = before.resolved.size > 0 || after.resolved.size > 0;
  if (options.includeTransitive && resolved) {
    const indirect = new Set([...before.resolved.keys(), ...after.resolved.keys()]);
    for (const name of indirect) {
      if (names.has(name)) continue;
      const left = before.resolved.get(name);
      const right = after.resolved.get(name);
      rows.push(
        rowFor(
          name,
          'prod',
          left?.version,
          right?.version,
          { before: left?.license, after: right?.license },
          true,
        ),
      );
    }
  }

  rows.sort(
    (one, two) =>
      Number(one.transitive ?? false) - Number(two.transitive ?? false) ||
      KIND_ORDER.indexOf(one.kind) - KIND_ORDER.indexOf(two.kind) ||
      one.name.localeCompare(two.name),
  );

  const stats: DepsDiffStats = {
    added: 0,
    removed: 0,
    modified: 0,
    same: 0,
    major: 0,
    downgrades: 0,
    licenseChanges: 0,
  };

  for (const row of rows) {
    if (row.status === 'add') stats.added += 1;
    else if (row.status === 'del') stats.removed += 1;
    else if (row.status === 'mod') stats.modified += 1;
    else stats.same += 1;

    if (row.bump?.startsWith('major') === true) stats.major += 1;
    if (row.downgrade === true) stats.downgrades += 1;
    if (
      row.licenseBefore !== undefined &&
      row.licenseAfter !== undefined &&
      row.licenseBefore !== row.licenseAfter
    ) {
      stats.licenseChanges += 1;
    }
  }

  const notes: string[] = [];
  notes.push(`Read ${sourceLabel(before.kind)} against ${sourceLabel(after.kind)}.`);

  if (!resolved) {
    // Rule 3, applied to what is *missing*: the reader has to know the numbers
    // they are not seeing, and how to see them.
    notes.push(
      'These are declared ranges, not installed versions. Compare the two lockfiles to see resolved versions, transitive packages and licences.',
    );
  }
  if (before.kind !== after.kind) {
    notes.push(`The two sides are different kinds of file, so versions may not be comparable.`);
  }
  if (before.kind === 'pnpm-lock' || after.kind === 'pnpm-lock') {
    notes.push('pnpm lockfiles do not record licences, so no licence change can be reported.');
  }
  if (before.kind === 'yarn-lock' || after.kind === 'yarn-lock') {
    notes.push(
      'A classic yarn.lock does not separate direct from transitive dependencies — every resolved package is listed as direct.',
    );
  }
  if (!options.includeDev) notes.push('Development dependencies were excluded.');
  if (!options.includeTransitive && resolved) {
    notes.push('Transitive packages were excluded from the list, but are still counted.');
  }
  if (stats.downgrades > 0) {
    notes.push(
      `${stats.downgrades} package${stats.downgrades === 1 ? '' : 's'} moved to a LOWER version — a rollback, not an upgrade.`,
    );
  }

  return {
    data: {
      rows,
      source: { before: sourceLabel(before.kind), after: sourceLabel(after.kind) },
      transitive: { before: before.resolved.size, after: after.resolved.size },
      resolved,
      project: {
        ...(before.project !== undefined ? { before: before.project } : {}),
        ...(after.project !== undefined ? { after: after.project } : {}),
      },
    },
    stats,
    notes,
  };
}
