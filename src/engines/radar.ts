/**
 * The Diff Radar's six axes (v0.2.7, MD §21).
 *
 * The feature's original note ends "ship only when scores are honest", and every
 * decision here follows from that:
 *
 *  - **An axis an engine cannot measure is ABSENT, not zero.** Zero is a claim —
 *    "nothing changed on this axis" — and a comparison of two images has nothing
 *    to say about dependencies. The chart draws an absent axis hollow and the
 *    legend names it, so a gap reads as a gap.
 *  - **Every score comes from a number the engine already computed.** Nothing here
 *    invents a metric; `ratioScore` only rescales counts the engine had anyway.
 *  - **One curve for every axis**, so `62` means the same thing wherever it appears.
 */

export const RADAR_AXES = [
  'structure',
  'content',
  'visual',
  'metadata',
  'dependencies',
  'performance',
] as const;

export type RadarAxis = (typeof RADAR_AXES)[number];

/** 0–100 per axis. A missing key means "this engine cannot measure that". */
export type RadarScores = Partial<Record<RadarAxis, number>>;

export const RADAR_LABELS: Record<RadarAxis, string> = {
  structure: 'Structure',
  content: 'Content',
  visual: 'Visual',
  metadata: 'Metadata',
  dependencies: 'Deps',
  performance: 'Weight',
};

/**
 * What each axis means, shown in the panel. Written down because "Performance" in
 * MD §21 has no stated definition, and an axis without one is where a dishonest
 * number gets in.
 */
export const RADAR_MEANING: Record<RadarAxis, string> = {
  structure: 'Things added or removed — keys, files, rows, packages.',
  content: 'Things changed in place, without appearing or disappearing.',
  visual: 'How much of the rendered picture differs.',
  metadata: 'Renames, type changes, licences — the facts around the data.',
  dependencies: 'How much of the dependency set moved.',
  performance: 'Whether the change makes the thing bigger or heavier.',
};

/**
 * A ratio (0–1) as a 0–100 score, on a curve that makes small real changes visible.
 *
 * Linear is the wrong shape here: a two-line change in a 4000-line file is 0.05%,
 * which draws as nothing at all — and yet "a couple of lines changed" is exactly
 * what the reader wants to see. The square root lifts the low end without letting
 * anything reach the rim until the change really is total.
 */
export function ratioScore(part: number, whole: number): number {
  if (whole <= 0) return 0;
  const ratio = Math.min(1, Math.max(0, part / whole));
  return Math.round(Math.sqrt(ratio) * 100);
}

/**
 * A signed magnitude as a score: how far two quantities are apart, relative to the
 * larger. Used for the weight axis, where "twice the size" and "half the size" are
 * both large changes.
 */
export function deltaScore(before: number, after: number): number {
  const largest = Math.max(Math.abs(before), Math.abs(after));
  if (largest <= 0) return 0;
  return ratioScore(Math.abs(after - before), largest);
}

/** Drops axes an engine could not measure, so `undefined` never reaches the chart. */
export function radarFrom(scores: Record<string, number | undefined>): RadarScores {
  const out: RadarScores = {};
  for (const axis of RADAR_AXES) {
    const value = scores[axis];
    if (value === undefined || Number.isNaN(value)) continue;
    out[axis] = Math.round(Math.min(100, Math.max(0, value)));
  }
  return out;
}
