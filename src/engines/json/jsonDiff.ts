/**
 * Structural JSON diff (MD §8.2).
 *
 * A text diff of two JSON documents answers the wrong question: reformat a file
 * and every line changes. This walks the two parsed values together and reports
 * what actually differs — per key, per array item, per type.
 *
 * Rule 3 (explainable): every normalisation that hides a difference is counted
 * in `suppressed` and named in the notes, so "no changes" never means "we
 * quietly dropped them".
 */

import { createNormalizer, DEFAULT_NORMALIZE_OPTIONS } from '../normalize';
import type { NormalizeOptions } from '../normalize';

export type JsonRowState = 'same' | 'add' | 'del' | 'chg' | 'type' | 'ign';

export interface JsonRowBadge {
  tone: 'add' | 'del' | 'mod' | 'info';
  text: string;
}

export interface JsonRow {
  /** Indentation level; 0 is the document root. */
  depth: number;
  /** `key` for object members, `[3]` for array items, `$` for the root. */
  key: string;
  /** JSONPath, e.g. `$.user.roles[1]`. What "Copy path" yields. */
  path: string;
  state: JsonRowState;
  /** Set on container rows, which have children rather than a value. */
  container?: 'obj' | 'arr';
  /** Formatted before value (`del`, `chg`, `type`). */
  a?: string;
  /** Formatted after value (`add`, `chg`, `type`). */
  b?: string;
  /** Formatted value when both sides agree. */
  value?: string;
  /** Why this row looks the way it does — shown verbatim next to the row. */
  note?: string;
  /** Container summary chip. */
  badge?: JsonRowBadge;
  /** Non-`same` descendants; container rows only. */
  changed?: number;
}

export interface JsonDiffOptions {
  /** Compare objects as sets of keys rather than ordered maps. */
  ignoreKeyOrder: boolean;
  /** Treat `null` and a missing key as equal. */
  ignoreNulls: boolean;
  /** Match array items by identity rather than by index. */
  ignoreArrayOrder: boolean;
  /** Glob paths whose differences are suppressed: `meta.id`, `*.updatedAt`, `orders[*].etag`. */
  ignorePaths: string[];
  /**
   * The shared normalisation rules (v0.2.6). Optional: absent means the defaults,
   * which are all off, so every pre-v0.2.6 option set behaves exactly as before.
   */
  normalize?: NormalizeOptions;
}

export const DEFAULT_JSON_OPTIONS: JsonDiffOptions = {
  ignoreKeyOrder: true,
  ignoreNulls: false,
  ignoreArrayOrder: true,
  ignorePaths: [],
};

export interface JsonDiffData {
  rows: JsonRow[];
  /** Nodes visited, for the status line. */
  nodes: number;
  /** True when a guard stopped the walk early. */
  truncated: boolean;
}

export interface JsonDiffStats {
  added: number;
  removed: number;
  changed: number;
  typeChanged: number;
  suppressed: number;
}

/** Deeper than this and the tree view stops being navigable anyway. */
export const MAX_DEPTH = 100;
/** A hard stop so a pathological document cannot exhaust the worker. */
export const MAX_NODES = 500_000;
/** Above this, arrays are matched by identity only — the per-item walk is too slow. */
export const LARGE_ARRAY = 10_000;

type JsonType = 'null' | 'array' | 'object' | 'string' | 'number' | 'boolean' | 'undefined';

/** `undefined` means "absent", which is distinct from a present `null`. */
const ABSENT = undefined;

export function typeOf(value: unknown): JsonType {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (value === ABSENT) return 'undefined';
  const raw = typeof value;
  return raw === 'object' ? 'object' : (raw as JsonType);
}

/** One-line rendering; containers collapse to a count so rows stay one line tall. */
export function formatValue(value: unknown): string {
  if (value === null) return 'null';
  if (value === ABSENT) return '—';
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[ ${value.length} item${value.length === 1 ? '' : 's'} ]`;
  if (typeof value === 'object') {
    const keys = Object.keys(value as object).length;
    return `{ ${keys} key${keys === 1 ? '' : 's'} }`;
  }
  return String(value);
}

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** JSONPath for an object member: dotted when the key is an identifier. */
function childPath(parent: string, key: string): string {
  return IDENTIFIER.test(key) ? `${parent}.${key}` : `${parent}[${JSON.stringify(key)}]`;
}

/**
 * The path form ignore-globs match against: no `$` root, `a.b[0].c`.
 * Users write `meta.requestId`, not `$.meta.requestId`.
 */
export function matchPath(path: string): string {
  return path.startsWith('$.') ? path.slice(2) : path === '$' ? '' : path.slice(1);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Compiles an ignore glob. `*` matches one path segment, `[*]` any array index.
 * Everything else is escaped, so a pattern can never be a regex injection.
 */
export function compileIgnore(pattern: string): RegExp {
  const source = pattern
    .split(/(\[\*\]|\*)/)
    .map((part) => {
      if (part === '[*]') return '\\[\\d+\\]';
      if (part === '*') return '[^.[\\]]*';
      return escapeRegExp(part);
    })
    .join('');
  return new RegExp(`^${source}$`);
}

class Ignorer {
  private readonly patterns: RegExp[];

  constructor(globs: readonly string[]) {
    this.patterns = globs.filter((glob) => glob.trim() !== '').map(compileIgnore);
  }

  matches(path: string): boolean {
    if (this.patterns.length === 0) return false;
    const subject = matchPath(path);
    if (subject === '') return false;
    return this.patterns.some((pattern) => pattern.test(subject));
  }
}

/** Stable signature used to match array items by identity. */
function signature(value: unknown): string {
  return JSON.stringify(value ?? null);
}

export function diffJson(
  before: unknown,
  after: unknown,
  options: JsonDiffOptions,
  shouldAbort?: () => boolean,
): { data: JsonDiffData; stats: JsonDiffStats; notes: string[] } {
  const rows: JsonRow[] = [];
  const stats: JsonDiffStats = {
    added: 0,
    removed: 0,
    changed: 0,
    typeChanged: 0,
    suppressed: 0,
  };
  const ignorer = new Ignorer(options.ignorePaths);
  // One normaliser per comparison, because it accumulates the counts that make the
  // result explainable (Rule 3).
  const normalizer = createNormalizer(options.normalize ?? DEFAULT_NORMALIZE_OPTIONS);

  let truncated = false;
  let depthCapped = false;
  let largeArrays = 0;

  // Running count of *leaf* differences, so a container can learn how many
  // changes it holds by subtraction instead of rescanning its subtree — the
  // difference between O(n) and O(n²) on a deep document.
  let differences = 0;

  const push = (row: JsonRow): void => {
    if (rows.length >= MAX_NODES) {
      truncated = true;
      return;
    }
    if (row.container === undefined && row.state !== 'same' && row.state !== 'ign') {
      differences += 1;
    }
    rows.push(row);
  };

  const walk = (x: unknown, y: unknown, key: string, depth: number, path: string): void => {
    if (truncated) return;
    if (shouldAbort?.() === true) throw new DOMException('Comparison cancelled', 'AbortError');

    if (depth > MAX_DEPTH) {
      depthCapped = true;
      push({
        depth,
        key,
        path,
        state: 'ign',
        note: `deeper than ${MAX_DEPTH} levels — not compared`,
      });
      return;
    }

    if (ignorer.matches(path)) {
      stats.suppressed += 1;
      push({
        depth,
        key,
        path,
        state: 'ign',
        value: formatValue(x !== ABSENT ? x : y),
        note: 'ignored by normalisation',
      });
      return;
    }

    const presentX = x !== ABSENT;
    const presentY = y !== ABSENT;

    if (options.ignoreNulls && ((x === null && !presentY) || (y === null && !presentX))) {
      stats.suppressed += 1;
      push({ depth, key, path, state: 'same', value: 'null', note: 'null ≡ missing' });
      return;
    }

    if (!presentX) {
      stats.added += 1;
      push({ depth, key, path, state: 'add', b: formatValue(y) });
      return;
    }
    if (!presentY) {
      stats.removed += 1;
      push({ depth, key, path, state: 'del', a: formatValue(x) });
      return;
    }

    const typeX = typeOf(x);
    const typeY = typeOf(y);
    if (typeX !== typeY) {
      stats.typeChanged += 1;
      push({
        depth,
        key,
        path,
        state: 'type',
        a: formatValue(x),
        b: formatValue(y),
        note: `${typeX} → ${typeY}`,
      });
      return;
    }

    if (typeX === 'object') {
      const left = x as Record<string, unknown>;
      const right = y as Record<string, unknown>;
      const union = [...new Set([...Object.keys(left), ...Object.keys(right)])];
      const keys = options.ignoreKeyOrder ? union.sort() : union;

      const at = rows.length;
      push({ depth, key, path, state: 'same', container: 'obj' });
      const header = rows[at];
      const mark = differences;

      for (const childKey of keys) {
        walk(left[childKey], right[childKey], childKey, depth + 1, childPath(path, childKey));
      }

      if (header !== undefined) {
        const changed = differences - mark;
        header.changed = changed;
        if (changed > 0) {
          header.state = 'chg';
          header.badge = { tone: 'mod', text: `${changed} changed` };
        }
      }
      return;
    }

    if (typeX === 'array') {
      const left = x as unknown[];
      const right = y as unknown[];
      const at = rows.length;
      push({ depth, key, path, state: 'same', container: 'arr' });
      const header = rows[at];
      const mark = differences;

      const huge = Math.max(left.length, right.length) > LARGE_ARRAY;
      if (huge) largeArrays += 1;

      if (options.ignoreArrayOrder || huge) {
        diffArrayByIdentity(left, right, depth, path, walk, push, stats);
      } else {
        const length = Math.max(left.length, right.length);
        for (let index = 0; index < length; index += 1) {
          walk(left[index], right[index], `[${index}]`, depth + 1, `${path}[${index}]`);
        }
      }

      if (header !== undefined) {
        const changed = differences - mark;
        header.changed = changed;
        const resized = left.length !== right.length;
        if (changed > 0) header.state = 'chg';
        header.badge = {
          tone: resized ? (right.length > left.length ? 'add' : 'del') : 'mod',
          text:
            `${left.length} → ${right.length} items` + (changed > 0 ? ` · ${changed} changed` : ''),
        };
      }
      return;
    }

    if (Object.is(x, y)) {
      push({ depth, key, path, state: 'same', value: formatValue(x) });
      return;
    }

    // v0.2.6: two scalars that differ only by a normalisation rule are the same
    // value as far as this comparison is concerned — and the rule says so.
    if (
      !normalizer.inert &&
      typeX === typeY &&
      (typeX === 'string' || typeX === 'number') &&
      normalizer.equivalent(String(x), String(y))
    ) {
      stats.suppressed += 1;
      push({ depth, key, path, state: 'ign', value: formatValue(y), note: 'normalised' });
      return;
    }

    stats.changed += 1;
    push({ depth, key, path, state: 'chg', a: formatValue(x), b: formatValue(y) });
  };

  walk(before, after, '$', 0, '$');

  const notes: string[] = [...normalizer.notes()];
  if (options.ignoreKeyOrder) notes.push('Compared objects as sets of keys (order ignored).');
  if (options.ignoreNulls) notes.push('Treated null and missing keys as equal.');
  if (options.ignoreArrayOrder) notes.push('Matched array items by identity, not index.');
  if (options.ignorePaths.length > 0) {
    notes.push(`Ignored paths: ${options.ignorePaths.join(', ')}.`);
  }
  if (largeArrays > 0) {
    notes.push(
      `${largeArrays} array${largeArrays === 1 ? '' : 's'} longer than ${LARGE_ARRAY.toLocaleString()} items were matched by identity only.`,
    );
  }
  if (depthCapped) notes.push(`Stopped descending below ${MAX_DEPTH} levels.`);
  if (truncated) {
    notes.push(`Stopped after ${MAX_NODES.toLocaleString()} nodes — the rest is not shown.`);
  }

  return {
    data: { rows, nodes: rows.length, truncated },
    stats,
    notes,
  };
}

/**
 * Identity matching: items present on both sides are `same` wherever they moved
 * to, leftovers on each side become removals and additions. This is what stops a
 * reordered array from reading as "everything changed".
 */
function diffArrayByIdentity(
  left: readonly unknown[],
  right: readonly unknown[],
  depth: number,
  path: string,
  walk: (x: unknown, y: unknown, key: string, depth: number, path: string) => void,
  push: (row: JsonRow) => void,
  stats: JsonDiffStats,
): void {
  const pool = new Map<string, number[]>();
  right.forEach((item, index) => {
    const key = signature(item);
    const bucket = pool.get(key);
    if (bucket === undefined) pool.set(key, [index]);
    else bucket.push(index);
  });

  const unmatchedLeft: number[] = [];

  left.forEach((item, index) => {
    const bucket = pool.get(signature(item));
    if (bucket !== undefined && bucket.length > 0) {
      bucket.shift();
      push({
        depth: depth + 1,
        key: `[${index}]`,
        path: `${path}[${index}]`,
        state: 'same',
        value: formatValue(item),
      });
    } else {
      unmatchedLeft.push(index);
    }
  });

  const unmatchedRight = [...pool.values()].flat().sort((one, two) => one - two);

  // Leftovers pair up positionally so an edited item reads as one change rather
  // than a delete plus an unrelated add.
  const pairs = Math.min(unmatchedLeft.length, unmatchedRight.length);
  for (let index = 0; index < pairs; index += 1) {
    const leftIndex = unmatchedLeft[index] as number;
    const rightIndex = unmatchedRight[index] as number;
    walk(left[leftIndex], right[rightIndex], `[${leftIndex}]`, depth + 1, `${path}[${leftIndex}]`);
  }

  for (let index = pairs; index < unmatchedLeft.length; index += 1) {
    const leftIndex = unmatchedLeft[index] as number;
    stats.removed += 1;
    push({
      depth: depth + 1,
      key: `[${leftIndex}]`,
      path: `${path}[${leftIndex}]`,
      state: 'del',
      a: formatValue(left[leftIndex]),
    });
  }

  for (let index = pairs; index < unmatchedRight.length; index += 1) {
    const rightIndex = unmatchedRight[index] as number;
    stats.added += 1;
    push({
      depth: depth + 1,
      key: `[${rightIndex}]`,
      path: `${path}[${rightIndex}]`,
      state: 'add',
      b: formatValue(right[rightIndex]),
    });
  }
}
