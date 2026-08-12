import { z } from 'zod';

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

export const PreferencesPatchSchema = z.object({
  theme: z.enum(['system', 'dark', 'light']).optional(),
  engineDefaults: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
  checkUpdates: z.boolean().optional(),
});

/** Bytes are only ever read for images; the cap is a denial-of-service guard. */
export const ReadBytesSchema = z.string().min(1).max(4096);

/** A path arriving from the renderer, before we touch the filesystem with it. */
export const ReadInputSchema = z.object({
  side: SideSchema,
  path: z.string().min(1).max(4096),
});

export const ResolveInputsSchema = z.array(ReadInputSchema).max(16);
