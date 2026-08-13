/**
 * The normalisation pipeline (v0.2.6, MD §22, A15).
 *
 * One idea, shared by every engine that compares values: a difference can be
 * *noise* — a regenerated id, a build timestamp, a hash — and the comparison
 * should be able to look past it while saying that it did (Rule 3).
 *
 * **It is a masking function, not a matcher.** `mask("user_9f2c… created")` replaces
 * the id with a placeholder and leaves the rest alone, so two values are equivalent
 * when their masks agree. Whole-value matching would only handle a value that *is*
 * an id; masking handles one embedded in a sentence, which is the common case — a
 * log line, an error message, a generated comment.
 *
 * Tolerance is the one thing a mask cannot express, so `timestampToleranceMs` is
 * checked separately and first: when both whole values are timestamps, they are
 * equal if they are close enough.
 */

export interface CustomRule {
  /** JavaScript regular expression source. Compiled with `g`. */
  pattern: string;
  /** What to call it in the notes. Falls back to the pattern. */
  label?: string;
}

export interface NormalizeOptions {
  /** Mask anything that looks like a date-time. */
  timestamps: boolean;
  /**
   * When both values are *entirely* a timestamp, treat them as equal if they are
   * within this many milliseconds. `0` disables the tolerance check; masking (if
   * enabled) still applies.
   */
  timestampToleranceMs: number;
  uuids: boolean;
  /** Hex runs of 32 characters or more: md5, sha-1, sha-256, content hashes. */
  hashes: boolean;
  /** Numbers equal within `numberTolerance`. */
  numbers: boolean;
  numberTolerance: number;
  custom: CustomRule[];
}

export const DEFAULT_NORMALIZE_OPTIONS: NormalizeOptions = {
  // Every rule is off by default. Normalisation that nobody asked for is a
  // comparison quietly lying, which is worse than a noisy one.
  timestamps: false,
  timestampToleranceMs: 0,
  uuids: false,
  hashes: false,
  numbers: false,
  numberTolerance: 0,
  custom: [],
};

/** More than this and the rule list is a program, not a preference. */
export const MAX_CUSTOM_RULES = 8;
export const MAX_PATTERN_LENGTH = 200;

export interface AppliedRule {
  id: string;
  label: string;
  /** Differences this rule suppressed. */
  count: number;
}

/**
 * ISO 8601 and the two other shapes that actually turn up: a space instead of `T`
 * (SQL, log files) and a bare date. Deliberately not "anything Date can parse" —
 * `Date.parse` accepts `"12"` and a surprising amount of prose.
 */
const TIMESTAMP =
  /\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})?)?/g;

const UUID = /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g;

/** 32+ hex characters. Shorter runs are too often ordinary words or ids. */
const HASH = /\b[0-9a-fA-F]{32,}\b/g;

const BUILT_IN: Array<{
  id: string;
  label: string;
  pattern: RegExp;
  flag: keyof NormalizeOptions;
}> = [
  { id: 'timestamps', label: 'timestamps', pattern: TIMESTAMP, flag: 'timestamps' },
  { id: 'uuids', label: 'UUIDs', pattern: UUID, flag: 'uuids' },
  { id: 'hashes', label: 'hashes', pattern: HASH, flag: 'hashes' },
];

export interface Normalizer {
  /** True when nothing is enabled, so callers can skip the work entirely. */
  readonly inert: boolean;
  /** Masked form of a value, for use as a comparison key. */
  mask(value: string): string;
  /**
   * Are these two values the same once normalised? Records the rule that decided
   * so, which is what makes the result explainable.
   */
  equivalent(a: string, b: string): boolean;
  /** Rules that actually suppressed something, in a stable order. */
  applied(): AppliedRule[];
  /** Total suppressed differences across every rule. */
  suppressed(): number;
  /** Human-readable lines for `normalizationNotes`. */
  notes(): string[];
}

/**
 * Compiles the custom rules, skipping the ones that cannot compile.
 *
 * A bad pattern is a typo, not a failure worth aborting a comparison over — it is
 * reported through `notes()` instead, so the user can see their rule did nothing
 * rather than wondering why it had no effect.
 */
function compileCustom(rules: readonly CustomRule[]): {
  compiled: Array<{ id: string; label: string; pattern: RegExp }>;
  rejected: string[];
} {
  const compiled: Array<{ id: string; label: string; pattern: RegExp }> = [];
  const rejected: string[] = [];

  for (const [index, rule] of rules.slice(0, MAX_CUSTOM_RULES).entries()) {
    const source = rule.pattern.trim();
    if (source === '' || source.length > MAX_PATTERN_LENGTH) {
      if (source !== '') rejected.push(source.slice(0, 40));
      continue;
    }
    try {
      compiled.push({
        id: `custom-${index}`,
        label: rule.label?.trim() ?? source,
        // Always global: a rule is meant to mask every occurrence, and a
        // non-global regex in `replace` would only touch the first.
        pattern: new RegExp(source, 'g'),
      });
    } catch {
      rejected.push(source.slice(0, 40));
    }
  }

  return { compiled, rejected };
}

/** The whole value is a timestamp, so tolerance can be applied to it. */
function wholeTimestamp(value: string): number | null {
  const trimmed = value.trim();
  const match = new RegExp(`^(?:${TIMESTAMP.source})$`).exec(trimmed);
  if (match === null) return null;
  const time = Date.parse(trimmed.includes('T') ? trimmed : trimmed.replace(' ', 'T'));
  return Number.isNaN(time) ? null : time;
}

function wholeNumber(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === '' || !/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

export function createNormalizer(options: NormalizeOptions): Normalizer {
  const { compiled, rejected } = compileCustom(options.custom);
  const enabled = BUILT_IN.filter((rule) => options[rule.flag] === true);

  const inert =
    enabled.length === 0 &&
    compiled.length === 0 &&
    !(options.numbers && options.numberTolerance > 0) &&
    !(options.timestampToleranceMs > 0);

  const counts = new Map<string, number>();
  const labels = new Map<string, string>();
  const bump = (id: string, label: string): void => {
    counts.set(id, (counts.get(id) ?? 0) + 1);
    labels.set(id, label);
  };

  const mask = (value: string): string => {
    let masked = value;
    for (const rule of enabled) {
      // A fresh regex per call: a shared `g`-flagged one carries `lastIndex`
      // between calls, which silently skips matches on the second value.
      masked = masked.replace(new RegExp(rule.pattern.source, 'g'), `⟨${rule.id}⟩`);
    }
    for (const rule of compiled) {
      masked = masked.replace(new RegExp(rule.pattern.source, 'g'), `⟨${rule.id}⟩`);
    }
    // Numbers are deliberately *not* masked: a mask would equate `1` with `9999`,
    // which no tolerance asked for. They are handled whole-value, below.
    return masked;
  };

  return {
    inert,
    mask,

    equivalent(a, b) {
      if (a === b) return true;
      if (inert) return false;

      // Tolerance first: it is the one rule masking cannot express.
      if (options.timestampToleranceMs > 0) {
        const left = wholeTimestamp(a);
        const right = wholeTimestamp(b);
        if (
          left !== null &&
          right !== null &&
          Math.abs(left - right) <= options.timestampToleranceMs
        ) {
          bump('timestamps', `timestamps within ${options.timestampToleranceMs} ms`);
          return true;
        }
      }

      if (options.numbers && options.numberTolerance > 0) {
        const left = wholeNumber(a);
        const right = wholeNumber(b);
        if (left !== null && right !== null && Math.abs(left - right) <= options.numberTolerance) {
          bump('numbers', `numbers within ${options.numberTolerance}`);
          return true;
        }
      }

      const maskedA = mask(a);
      const maskedB = mask(b);
      if (maskedA !== maskedB) return false;

      // The masks agree but the values did not, so some rule masked the part that
      // differed. Attribute it to the first rule whose placeholder is in the mask —
      // with several rules in play the exact attribution is a judgement call, and a
      // named rule the user can switch off is more useful than "some rule".
      const claimant = [...enabled, ...compiled].find((rule) => maskedA.includes(`⟨${rule.id}⟩`));
      if (claimant !== undefined) bump(claimant.id, claimant.label);
      return true;
    },

    applied() {
      return [...counts.entries()]
        .map(([id, count]) => ({ id, label: labels.get(id) ?? id, count }))
        .sort((one, two) => two.count - one.count || one.id.localeCompare(two.id));
    },

    suppressed() {
      let total = 0;
      for (const count of counts.values()) total += count;
      return total;
    },

    notes() {
      const lines: string[] = [];
      for (const rule of this.applied()) {
        lines.push(
          `Ignored ${rule.count} difference${rule.count === 1 ? '' : 's'} in ${rule.label}.`,
        );
      }
      for (const bad of rejected) {
        lines.push(`Custom rule "${bad}" is not a valid regular expression and was skipped.`);
      }
      return lines;
    },
  };
}

/** Merges stored options over the defaults, tolerating a partial object. */
export function normalizeOptionsFrom(patch: unknown): NormalizeOptions {
  const source = (patch ?? {}) as Partial<NormalizeOptions>;
  return {
    ...DEFAULT_NORMALIZE_OPTIONS,
    ...source,
    custom: Array.isArray(source.custom) ? source.custom.slice(0, MAX_CUSTOM_RULES) : [],
  };
}
