import type { Summary } from '../engines/types';

/**
 * Thresholds — what makes a comparison *fail* a build (v0.3.4, MD §41 / A23).
 *
 * Pure and unit-tested, because a pipeline that goes red or green on this arithmetic
 * deserves better than a claim in prose.
 *
 * The important design point is what they do to the exit code. Without a threshold,
 * exit 1 means "these two differ" — which is the right answer for a diff tool and the
 * wrong one for a build step, where differing is usually the whole point of the commit.
 * With a threshold, exit 1 means "these differ by more than you allowed", and the
 * summary names the threshold that failed. Both meanings are useful; conflating them
 * silently would make one of them a trap.
 */

export interface Thresholds {
  /** Fail when added + removed + modified exceeds this. */
  maxChanges: number | undefined;
  /** Fail when the reported difference percentage exceeds this (images, pixels). */
  maxDiffPercent: number | undefined;
  /** Fail when the comparison reports a breaking change (the API engine). */
  failOnBreaking: boolean;
}

export const NO_THRESHOLDS: Thresholds = {
  maxChanges: undefined,
  maxDiffPercent: undefined,
  failOnBreaking: false,
};

export function hasThresholds(thresholds: Thresholds): boolean {
  return (
    thresholds.maxChanges !== undefined ||
    thresholds.maxDiffPercent !== undefined ||
    thresholds.failOnBreaking
  );
}

/**
 * The difference percentage an engine reported, if it reported one.
 *
 * Read from `summary.extra`, which is where every engine already puts its own
 * vocabulary — `difference: '8.00%'` for the image engine. Parsed rather than
 * recomputed: recomputing it here would mean this file knowing what a pixel is.
 */
export function differencePercent(summary: Summary): number | undefined {
  for (const [label, value] of Object.entries(summary.extra ?? {})) {
    if (!/diff/i.test(label)) continue;
    const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value));
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

/** How many breaking changes the comparison found, if it looked for any. */
export function breakingCount(summary: Summary): number | undefined {
  const value = (summary.extra ?? {})['breaking'];
  if (value === undefined) return undefined;
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : undefined;
}

export interface ThresholdResult {
  /** True when at least one threshold was exceeded. */
  failed: boolean;
  /** One line per threshold, whether it passed or not. */
  lines: string[];
  /** Only the failures, for an annotation. */
  failures: string[];
}

export function evaluate(summary: Summary, thresholds: Thresholds): ThresholdResult {
  const changes = summary.added + summary.removed + summary.modified;
  const lines: string[] = [];
  const failures: string[] = [];

  const note = (ok: boolean, text: string): void => {
    lines.push(`${ok ? 'ok' : 'FAIL'}  ${text}`);
    if (!ok) failures.push(text);
  };

  if (thresholds.maxChanges !== undefined) {
    note(
      changes <= thresholds.maxChanges,
      `changes ${changes} ${changes <= thresholds.maxChanges ? '≤' : '>'} allowed ${thresholds.maxChanges}`,
    );
  }

  if (thresholds.maxDiffPercent !== undefined) {
    const percent = differencePercent(summary);
    if (percent === undefined) {
      // A threshold that cannot be evaluated must not quietly pass: a build asking
      // "fail over 1% different" against a comparison with no percentage is a
      // mistake in the pipeline, and saying so is the only useful answer.
      note(
        false,
        `no difference percentage to compare against --max-diff ${thresholds.maxDiffPercent}%`,
      );
    } else {
      note(
        percent <= thresholds.maxDiffPercent,
        `difference ${percent}% ${percent <= thresholds.maxDiffPercent ? '≤' : '>'} allowed ${thresholds.maxDiffPercent}%`,
      );
    }
  }

  if (thresholds.failOnBreaking) {
    const breaking = breakingCount(summary);
    if (breaking === undefined) {
      note(
        false,
        'this comparison does not report breaking changes, so --fail-on-breaking cannot pass',
      );
    } else {
      note(breaking === 0, `${breaking} breaking change${breaking === 1 ? '' : 's'}`);
    }
  }

  return { failed: failures.length > 0, lines, failures };
}
