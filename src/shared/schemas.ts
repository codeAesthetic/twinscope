import { z } from 'zod';
import { isSafeRef } from '../engines/git/refs';
import { normalisePath } from './paths';

/**
 * Runtime validation for everything the renderer sends.
 *
 * Standing rule (plan §3.7): main validates every payload at the boundary. A
 * renderer is the least-trusted process in the app — treat its input like
 * network input, because a compromised renderer is exactly the threat model
 * context isolation exists for.
 *
 * Only main imports this. The preload gets types from `./channels` instead, so
 * zod never enters its bundle.
 */

export const SideSchema = z.enum(['A', 'B']);

export const InputKindSchema = z.enum([
  'text',
  'code',
  'json',
  'yaml',
  'csv',
  'xml',
  'deps',
  'api',
  'env',
  'html',
  'md',
  'image',
  'folder',
  'binary',
  'git',
  'unknown',
]);

/**
 * A git ref, validated with the engine's own guard (v0.2.1).
 *
 * `isSafeRef` lives in `engines/git/refs.ts` so the rule travels with the engine
 * and the CLI inherits it; importing it here is what makes the desktop path
 * enforce it *twice* — at the boundary, and again inside the engine.
 */
export const GitRefSchema = z
  .string()
  .min(1)
  .max(255)
  .refine(isSafeRef, 'Use a branch, tag, or commit id.');

export const InputPayloadSchema = z.object({
  side: SideSchema,
  kind: InputKindSchema,
  name: z.string().min(1).max(1024),
  path: z.string().min(1).max(4096).optional(),
  text: z.string().optional(),
  size: z.number().int().nonnegative(),
  lang: z.string().max(64).optional(),
  large: z.boolean().optional(),
  encoding: z.string().max(32).optional(),
  eol: z.string().max(8).optional(),
  lossy: z.boolean().optional(),
  ref: GitRefSchema.optional(),
});

export const CompareRequestSchema = z.object({
  a: InputPayloadSchema,
  b: InputPayloadSchema,
  engineId: z
    .string()
    .regex(/^[a-z][a-z0-9-]{0,31}$/, 'engine ids are lowercase slugs')
    .optional(),
  // Engine options are engine-specific; each engine validates its own shape.
  // Depth/size are bounded here so a hostile payload cannot exhaust the host.
  options: z.record(z.string(), z.unknown()).optional(),
});

export const JobIdSchema = z.string().uuid();

export const SummarySchema = z.object({
  added: z.number().int().nonnegative(),
  removed: z.number().int().nonnegative(),
  modified: z.number().int().nonnegative(),
  extra: z.record(z.string(), z.union([z.number(), z.string()])).optional(),
  suppressed: z.number().int().nonnegative().optional(),
  /**
   * Diff Radar scores (v0.2.7). Declared rather than left to zod's default
   * key-stripping: an undeclared field is silently dropped, which would quietly
   * empty the radar of anything that round-trips through a validated channel.
   */
  radar: z.record(z.string().max(32), z.number().min(0).max(100)).optional(),
});

export const HistoryRecordSchema = z.object({
  a: InputPayloadSchema,
  b: InputPayloadSchema,
  engineId: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/),
  options: z.record(z.string(), z.unknown()),
  summary: SummarySchema,
});

export const HistoryListSchema = z
  .object({
    limit: z.number().int().positive().max(500).optional(),
    starredOnly: z.boolean().optional(),
  })
  .optional();

export const HistoryIdSchema = z.number().int().positive();

export const SavedComparisonSchema = z.object({
  projectId: HistoryIdSchema.optional(),
  name: z.string().min(1).max(200),
  engineId: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/),
  a: InputPayloadSchema,
  b: InputPayloadSchema,
  options: z.record(z.string(), z.unknown()),
});

/** Optional project filter for the saved list. */
export const SavedListSchema = HistoryIdSchema.optional();

const ReportSideSchema = z.object({
  name: z.string().min(1).max(1024),
  path: z.string().max(4096).optional(),
  kind: z.string().max(32),
});

export const ReportFormatSchema = z.enum(['html', 'md', 'patch']);

export const ReportPayloadSchema = z.object({
  a: ReportSideSchema,
  b: ReportSideSchema,
  engineId: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/),
  summary: SummarySchema,
  options: z.record(z.string(), z.unknown()),
  normalizationNotes: z.array(z.string().max(2000)).max(64),
  generatedAt: z.string().max(64),
  // The engine's own model: shape-checked by the renderer that consumes it, and
  // size-bounded by the IPC layer rather than by a schema that would have to
  // know every engine.
  data: z.unknown(),
  images: z
    .object({
      before: z.string().optional(),
      after: z.string().optional(),
      mask: z.string().optional(),
    })
    .optional(),
});

/**
 * Every filesystem path arriving from the renderer (plan §3.7 item 5).
 *
 * Normalisation happens *here*, in the schema, rather than in each handler:
 * that way a new channel that takes a path cannot forget it, which is the whole
 * argument for validating at the boundary. Downstream code only ever sees an
 * absolute, NUL-free, canonical path.
 */
export const PathSchema = z
  .string()
  .min(1)
  .max(4096)
  .transform((raw, ctx) => {
    try {
      return normalisePath(raw);
    } catch (cause) {
      ctx.addIssue({
        code: 'custom',
        message: cause instanceof Error ? cause.message : 'That path cannot be opened.',
      });
      return z.NEVER;
    }
  });

export const RevealPathSchema = PathSchema;

/**
 * A project (v0.2.9). Bounded everywhere a renderer could push volume: presets are
 * one object per engine, and an ignore list is a list rather than a place to keep a
 * megabyte. `root` goes through `PathSchema`, like every other path from a renderer —
 * declared here, below it, for that reason.
 */
export const ProjectPatchSchema = z.object({
  id: HistoryIdSchema.optional(),
  name: z.string().min(1).max(120),
  root: PathSchema.optional(),
  presets: z.record(z.string().max(32), z.record(z.string().max(64), z.unknown())).optional(),
  ignores: z.array(z.string().min(1).max(256)).max(64).optional(),
});

/** Two inputs handed from the quick panel to the main window (v0.2.14). */
export const QuickHandoffSchema = z.object({
  a: InputPayloadSchema,
  b: InputPayloadSchema,
});

export const PreferencesPatchSchema = z.object({
  theme: z.enum(['system', 'dark', 'light']).optional(),
  // `null` clears it, which is how "no project" is expressed (v0.2.9).
  activeProjectId: z.number().int().positive().nullable().optional(),
  globalShortcut: z.boolean().optional(),
  clipboardWatcher: z.boolean().optional(),
  engineDefaults: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
  checkUpdates: z.boolean().optional(),
});

/** Bytes are only ever read for images; the cap is a denial-of-service guard. */
export const ReadBytesSchema = PathSchema;

/** A path arriving from the renderer, before we touch the filesystem with it. */
export const ReadInputSchema = z.object({
  side: SideSchema,
  path: PathSchema,
});

export const ResolveInputsSchema = z.array(ReadInputSchema).max(16);

/**
 * A byte range of a file (v0.2.8). The span itself is bounded in `main/input.ts`,
 * where the number is next to the read that honours it.
 */
export const ReadRangeSchema = z.object({
  path: PathSchema,
  start: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  end: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
});

/** The folder the user picked; `probeRepo` finds the repository root above it. */
export const GitProbeSchema = PathSchema;

/**
 * A blob request (v0.2.1).
 *
 * `repo` is a filesystem path and goes through `PathSchema`. `path` is a
 * *repository-relative pathspec*, not a filesystem path, so it deliberately does
 * not: `main/git.ts` checks it against the rules a pathspec has to satisfy
 * instead — no leading `-`, no absolute form, no `..` segment.
 */
export const GitBlobSchema = z.object({
  repo: PathSchema,
  ref: GitRefSchema,
  path: z.string().min(1).max(4096),
});
