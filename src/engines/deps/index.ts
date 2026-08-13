import {
  DEFAULT_DEPS_OPTIONS,
  diffDeps,
  type DepsDiffData,
  type DepsDiffOptions,
} from './depsDiff';
import { DepParseError, isDependencyFile } from './manifest';
import { deltaScore, radarFrom, ratioScore } from '../radar';
import { EngineInputError, type DiffEngine, type DiffResult, type InputRef } from '../types';

export type { DepRow, DepStatus, DepsDiffData, DepsDiffOptions } from './depsDiff';
export { DEFAULT_DEPS_OPTIONS, diffDeps } from './depsDiff';
export {
  isDependencyFile,
  sourceKindFor,
  sourceLabel,
  readDepSource,
  DepParseError,
} from './manifest';
export type { DepKind, SourceKind } from './manifest';
export { bumpBetween, bumpLabel, parseVersion, stripRange } from './semver';

async function textFor(input: InputRef, read: (path: string) => Promise<string>): Promise<string> {
  if (input.text !== undefined) return input.text;
  if (input.path !== undefined) return read(input.path);
  throw new Error(`${input.name} has no readable content.`);
}

/**
 * Dependency comparison (v0.2.10, A12).
 *
 * Deliberately accepts **either** two manifests or two lockfiles, and does what each
 * allows: ranges and bumps from manifests, plus resolved versions, transitive counts
 * and licences from lockfiles. What it will not do is read the lockfile sitting next
 * to a manifest — that would mean widening the engine worker's filesystem scope from
 * the two inputs the user chose to their whole directories, and a convenience is not
 * worth weakening containment for (plan §3.7). Picking the two lockfiles instead is
 * one extra click and stays honest.
 */
export const depsEngine: DiffEngine<DepsDiffOptions, DepsDiffData> = {
  meta: { id: 'deps', label: 'Dependency diff', priority: 30 },

  canHandle: (a, b) => a.kind === 'deps' && b.kind === 'deps',

  defaultOptions: () => ({ ...DEFAULT_DEPS_OPTIONS }),

  async compare(a, b, options, ctx): Promise<DiffResult<DepsDiffData>> {
    const startedAt = Date.now();
    const read = async (path: string): Promise<string> => {
      if (ctx.fs === undefined) throw new Error('No filesystem access was provided.');
      return ctx.fs.readText(path);
    };

    ctx.progress(10, 'reading');
    const [rawA, rawB] = await Promise.all([textFor(a, read), textFor(b, read)]);

    if (ctx.signal.aborted) throw new DOMException('Comparison cancelled', 'AbortError');

    if (!isDependencyFile(a.name) || !isDependencyFile(b.name)) {
      throw new EngineInputError(
        'A dependency comparison needs a package.json or a lockfile on both sides.',
        { fallbackEngineId: 'json', fallbackLabel: 'Compare as JSON' },
      );
    }

    ctx.progress(45, 'resolving dependencies');
    let result;
    try {
      result = diffDeps(a.name, rawA, b.name, rawB, options);
    } catch (cause) {
      if (cause instanceof DepParseError) {
        throw new EngineInputError(`${cause.message}.`, {
          fallbackEngineId: 'text',
          fallbackLabel: 'Compare as text',
        });
      }
      throw cause;
    }

    const { data, stats, notes } = result;
    ctx.progress(100, 'done');

    const extra: Record<string, number | string> = {};
    if (data.resolved) {
      extra.packages = `${data.transitive.before} → ${data.transitive.after}`;
    }
    if (stats.major > 0) extra.major = stats.major;
    if (stats.downgrades > 0) extra.downgrades = `⚠ ${stats.downgrades}`;
    if (stats.licenseChanges > 0) extra.licences = `⚠ ${stats.licenseChanges}`;
    extra.unchanged = stats.same;

    return {
      engineId: 'deps',
      summary: {
        added: stats.added,
        removed: stats.removed,
        modified: stats.modified,
        extra,
        // Radar (v0.2.7) — the axis this engine exists to feed. `dependencies` is the
        // share of the set that moved at all; `metadata` is licence changes, which
        // only an npm lockfile can report, so it is absent for the other two.
        radar: radarFrom({
          dependencies: ratioScore(
            stats.added + stats.removed + stats.modified,
            Math.max(1, data.rows.length),
          ),
          structure: ratioScore(stats.added + stats.removed, Math.max(1, data.rows.length)),
          content: ratioScore(stats.modified, Math.max(1, data.rows.length)),
          metadata: data.resolved
            ? ratioScore(stats.licenseChanges, Math.max(1, data.rows.length))
            : undefined,
          performance: data.resolved
            ? deltaScore(data.transitive.before, data.transitive.after)
            : undefined,
        }),
      },
      data,
      normalizationNotes: notes,
      timings: { ms: Date.now() - startedAt },
    };
  },
};
