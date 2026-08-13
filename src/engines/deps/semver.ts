/**
 * Just enough semver to say how far a version moved (v0.2.10).
 *
 * Ours rather than the `semver` package: what this needs is ~60 lines, and the one
 * question that matters — *which way* did it move — is not what `semver.diff`
 * answers. A downgrade from 3.0.0 to 2.9.0 is a major change and also a rollback,
 * and those are different things to a reader.
 */

export type BumpKind = 'major' | 'minor' | 'patch' | 'prerelease' | 'range' | 'unknown';

export interface Bump {
  kind: BumpKind;
  /** True when the AFTER version is lower than the BEFORE one. */
  downgrade: boolean;
}

export interface Version {
  major: number;
  minor: number;
  patch: number;
  /** `-beta.1`, without the dash. Empty when there is none. */
  prerelease: string;
}

/** The leading range operator, if any: `^`, `~`, `>=`, `<`, `=`, `v`. */
const OPERATOR = /^[\s=v^~><]*/;

const VERSION = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?/;

/** Strips the range operator so `^1.2.3` and `1.2.3` compare as the same version. */
export function stripRange(range: string): string {
  return range.trim().replace(OPERATOR, '');
}

export function parseVersion(range: string): Version | null {
  const match = VERSION.exec(stripRange(range));
  if (match === null) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2] ?? 0),
    patch: Number(match[3] ?? 0),
    prerelease: match[4] ?? '',
  };
}

function compare(left: Version, right: Version): number {
  if (left.major !== right.major) return left.major - right.major;
  if (left.minor !== right.minor) return left.minor - right.minor;
  if (left.patch !== right.patch) return left.patch - right.patch;
  // A release outranks any prerelease of the same numbers.
  if (left.prerelease === right.prerelease) return 0;
  if (left.prerelease === '') return 1;
  if (right.prerelease === '') return -1;
  return left.prerelease < right.prerelease ? -1 : 1;
}

/**
 * How far the version moved, and in which direction.
 *
 * `range` means the numbers are identical and only the operator changed — pinning
 * `1.2.3` to exactly `1.2.3` from `^1.2.3` is a real and deliberate change, and
 * calling it "no change" would hide the intent.
 */
export function bumpBetween(before: string, after: string): Bump {
  const left = parseVersion(before);
  const right = parseVersion(after);

  if (left === null || right === null) {
    // A git URL, a `file:` path, a `workspace:*` — different, but not on a scale.
    return { kind: 'unknown', downgrade: false };
  }

  const order = compare(left, right);
  const downgrade = order > 0;

  if (left.major !== right.major) return { kind: 'major', downgrade };
  if (left.minor !== right.minor) return { kind: 'minor', downgrade };
  if (left.patch !== right.patch) return { kind: 'patch', downgrade };
  if (left.prerelease !== right.prerelease) return { kind: 'prerelease', downgrade };

  return { kind: 'range', downgrade: false };
}

/** How a bump reads as a badge. */
export function bumpLabel(bump: Bump): string {
  if (bump.kind === 'range') return 'range';
  if (bump.kind === 'unknown') return 'changed';
  return bump.downgrade ? `${bump.kind} ↓` : bump.kind;
}
