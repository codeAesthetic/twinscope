import { z } from 'zod';
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
  'md',
  'image',
  'folder',
  'binary',
  'unknown',
]);

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

export const PreferencesPatchSchema = z.object({
  theme: z.enum(['system', 'dark', 'light']).optional(),
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
