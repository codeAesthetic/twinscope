import {
  flattenK8s,
  flattenPlan,
  flattenTree,
  isEnvName,
  isTfvarsName,
  looksLikeK8s,
  looksLikePlan,
  parseEnv,
  type ConfigEntry,
  type ConfigKind,
} from './parse';
import { maskValue, SECRET_REASON_LABEL, type SecretReason } from './secrets';
import { createNormalizer, DEFAULT_NORMALIZE_OPTIONS, type NormalizeOptions } from '../normalize';
import { radarFrom, ratioScore } from '../radar';
import { EngineInputError } from '../types';
import type { DiffEngine, DiffResult, InputRef } from '../types';

/**
 * Environment and configuration comparison (v0.3.7, A13).
 *
 * `.env` files, Kubernetes manifests and Terraform plans reduce to the same thing —
 * `key → value` — so one row model, one masking pass and one view serve all three.
 * What differs is only how the keys are arrived at (see `parse.ts`).
 *
 * **Secret masking is the feature, not a setting on it.** A13's note says so, and the
 * design follows: masking happens here, before the row model exists, so the renderer,
 * the HTML report, the clipboard and the CLI cannot each leak it separately. A masked
 * value still compares — the fingerprint is stable — because "these two secrets
 * differ" is the half of the answer that matters.
 */

export type EnvRowState = 'same' | 'added' | 'removed' | 'changed' | 'emptied' | 'filled';

export interface EnvRow {
  key: string;
  state: EnvRowState;
  /** Masked unless `revealSecrets` is on. Absent when the key is only on one side. */
  before: string | undefined;
  after: string | undefined;
  secret: boolean;
  secretReason: SecretReason;
  /** Set when the source held base64 (a K8s Secret) and this is the decoded value. */
  decoded?: boolean;
}

export interface EnvDiffData {
  kind: ConfigKind;
  rows: EnvRow[];
  /** Keys present on both sides with equal values. */
  same: number;
  secrets: number;
}

export interface EnvDiffOptions {
  /**
   * Show real values for keys judged secret. **Per comparison and never persisted**:
   * a remembered "show secrets" is a credential in the next screenshot.
   */
  revealSecrets: boolean;
  /** Keys to leave out entirely, as globs — `*_AT`, `BUILD_*`. */
  ignoreKeys: string[];
  /** The shared rules (v0.2.6): a regenerated id in a value is not a change. */
  normalize?: NormalizeOptions;
}

export const DEFAULT_ENV_OPTIONS: EnvDiffOptions = {
  revealSecrets: false,
  ignoreKeys: [],
  normalize: DEFAULT_NORMALIZE_OPTIONS,
};

const FALLBACK = { fallbackEngineId: 'text', fallbackLabel: 'Compare as text' };

/** Which config shape this input is, or null. */
export function configKindOf(input: Pick<InputRef, 'name' | 'text'>): ConfigKind | null {
  if (isEnvName(input.name)) return 'env';
  if (isTfvarsName(input.name)) return 'tfvars';
  const text = input.text;
  if (text === undefined || text === '') return null;
  if (looksLikePlan(text)) return 'tfplan';
  if (looksLikeK8s(text)) return 'k8s';
  return null;
}

/**
 * Compiles an ignore glob: `*` matches anything, everything else is literal.
 *
 * Built by splitting on `*` rather than by substituting a placeholder character —
 * the placeholder version of this function shipped a literal NUL into the source,
 * which is invisible in every editor and every diff, and which eslint's
 * `no-control-regex` was right to reject.
 */
function globToRegExp(glob: string): RegExp {
  const literal = glob.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`^${literal.join('.*')}$`);
}

/** Parses one side into flat entries, by shape. */
function entriesOf(input: InputRef, kind: ConfigKind, parseYaml: ParseYaml): ConfigEntry[] {
  const text = input.text ?? '';

  if (kind === 'env') return parseEnv(text);

  if (kind === 'tfvars') {
    if (input.name.endsWith('.json')) {
      const out: ConfigEntry[] = [];
      flattenTree(JSON.parse(text), '', out);
      return out;
    }
    // A `.tfvars` file is HCL's assignment subset, which is `key = value` — close
    // enough to a dotenv line to read with the same parser once `=` is normalised.
    return parseEnv(text.replace(/^\s*([A-Za-z_][\w-]*)\s*=/gm, '$1='));
  }

  if (kind === 'tfplan') {
    const out: ConfigEntry[] = [];
    flattenPlan(JSON.parse(text), out);
    return out;
  }

  const out: ConfigEntry[] = [];
  for (const document of parseYaml(text)) flattenK8s(document, out);
  return out;
}

/** Injected so this engine does not depend on which YAML parser the host bundles. */
export type ParseYaml = (text: string) => unknown[];

export function diffConfig(
  before: readonly ConfigEntry[],
  after: readonly ConfigEntry[],
  options: EnvDiffOptions,
  salt: string,
): { rows: EnvRow[]; same: number; secrets: number; suppressed: number } {
  const ignore = options.ignoreKeys.map(globToRegExp);
  const skip = (key: string): boolean => ignore.some((pattern) => pattern.test(key));

  const left = new Map(
    before.filter((entry) => !skip(entry.key)).map((entry) => [entry.key, entry]),
  );
  const right = new Map(
    after.filter((entry) => !skip(entry.key)).map((entry) => [entry.key, entry]),
  );

  const normalizer = createNormalizer(options.normalize ?? DEFAULT_NORMALIZE_OPTIONS);
  const rows: EnvRow[] = [];
  let same = 0;
  let secrets = 0;
  let suppressed = 0;

  const mask = (key: string, value: string): ReturnType<typeof maskValue> =>
    maskValue(key, value, { reveal: options.revealSecrets, salt });

  for (const key of new Set([...left.keys(), ...right.keys()])) {
    const a = left.get(key);
    const b = right.get(key);

    if (a !== undefined && b !== undefined) {
      const equal =
        a.value === b.value ||
        (!normalizer.inert && normalizer.mask(a.value) === normalizer.mask(b.value));
      if (!normalizer.inert && a.value !== b.value && equal) suppressed += 1;

      const maskedA = mask(key, a.value);
      const maskedB = mask(key, b.value);
      if (maskedA.masked || maskedB.masked) secrets += 1;

      if (equal) {
        same += 1;
        rows.push({
          key,
          state: 'same',
          before: maskedA.display,
          after: maskedB.display,
          secret: maskedA.masked || maskedB.masked,
          secretReason: maskedA.reason,
          ...(a.decoded === true || b.decoded === true ? { decoded: true } : {}),
        });
        continue;
      }

      // `KEY=` and `KEY=value` are their own states. Every config system that has
      // caused an incident has done it through the difference between empty and
      // absent, and a flat "changed" hides it.
      const state: EnvRowState = a.empty ? 'filled' : b.empty ? 'emptied' : 'changed';
      rows.push({
        key,
        state,
        before: maskedA.display,
        after: maskedB.display,
        secret: maskedA.masked || maskedB.masked,
        secretReason: maskedA.reason === 'none' ? maskedB.reason : maskedA.reason,
        ...(a.decoded === true || b.decoded === true ? { decoded: true } : {}),
      });
      continue;
    }

    const only = (a ?? b) as ConfigEntry;
    const masked = mask(key, only.value);
    if (masked.masked) secrets += 1;
    rows.push({
      key,
      state: a === undefined ? 'added' : 'removed',
      before: a === undefined ? undefined : masked.display,
      after: a === undefined ? masked.display : undefined,
      secret: masked.masked,
      secretReason: masked.reason,
      ...(only.decoded === true ? { decoded: true } : {}),
    });
  }

  // Changed first, then added, removed, and the unchanged last: a config diff is read
  // for what moved, and 200 identical keys above the one that changed is a diff
  // nobody reads to the end.
  const order: Record<EnvRowState, number> = {
    changed: 0,
    emptied: 1,
    filled: 2,
    added: 3,
    removed: 4,
    same: 5,
  };
  rows.sort((one, other) =>
    order[one.state] === order[other.state]
      ? one.key.localeCompare(other.key)
      : order[one.state] - order[other.state],
  );

  return { rows, same, secrets, suppressed };
}

/**
 * The engine.
 *
 * `parseYaml` is injected by `catalog.ts` rather than imported here, so this module
 * keeps working in a host that bundles no YAML parser — and so the K8s path uses
 * exactly the parser v0.2.3 already proved, rather than a second one.
 */
export function createEnvEngine(parseYaml: ParseYaml): DiffEngine<EnvDiffOptions, EnvDiffData> {
  return {
    // Above `yaml` and `json`: a K8s manifest pair is a config comparison first and a
    // YAML document pair second. Both remain one dropdown pick away.
    meta: { id: 'env', label: 'Config diff', priority: 58 },

    canHandle: (a, b) => a.kind === 'env' && b.kind === 'env',

    defaultOptions: () => ({ ...DEFAULT_ENV_OPTIONS, ignoreKeys: [] }),

    async compare(a, b, options, ctx): Promise<DiffResult<EnvDiffData>> {
      const startedAt = Date.now();
      ctx.progress(10, 'reading');

      const kindA = configKindOf(a);
      const kindB = configKindOf(b);
      if (kindA === null || kindB === null) {
        throw new EngineInputError(
          `${kindA === null ? a.name : b.name} is not a config file this engine reads.`,
          FALLBACK,
        );
      }
      if (kindA !== kindB) {
        throw new EngineInputError(
          `${a.name} is ${kindA} and ${b.name} is ${kindB} — those are different kinds of configuration.`,
          FALLBACK,
        );
      }

      let before: ConfigEntry[];
      let after: ConfigEntry[];
      try {
        before = entriesOf(a, kindA, parseYaml);
        after = entriesOf(b, kindB, parseYaml);
      } catch (cause) {
        throw new EngineInputError(
          `Could not read these as ${kindA}: ${cause instanceof Error ? cause.message : String(cause)}`,
          FALLBACK,
        );
      }

      ctx.progress(55, 'comparing keys');
      // One salt per comparison: a fingerprint that is stable across runs would be
      // one an attacker could build a table for, and it only has to be stable *within*
      // the pair being compared.
      const salt = `${a.name}|${b.name}|${before.length}|${after.length}`;
      const { rows, same, secrets, suppressed } = diffConfig(before, after, options, salt);

      const changed = rows.filter(
        (row) => row.state === 'changed' || row.state === 'emptied' || row.state === 'filled',
      ).length;
      const added = rows.filter((row) => row.state === 'added').length;
      const removed = rows.filter((row) => row.state === 'removed').length;

      const notes: string[] = [
        options.revealSecrets
          ? `Secrets are SHOWN. ${secrets} value${secrets === 1 ? '' : 's'} would otherwise be masked — do not export or screenshot this.`
          : `${secrets} value${secrets === 1 ? '' : 's'} judged secret and masked. Masking happens in the engine, so an exported report and a copied row carry the mask too.`,
        'A masked value still compares: its fingerprint is stable, so two secrets that differ are reported as differing without either being shown.',
      ];
      if (kindA === 'k8s') {
        notes.push(
          'Kubernetes objects are keyed by kind, namespace and name rather than by their position in the file — two clusters never emit them in the same order.',
        );
        if (rows.some((row) => row.decoded === true)) {
          notes.push(
            'Secret values were base64-decoded before comparison, then masked: two Secrets differing only in padding hold the same secret.',
          );
        }
      }
      if (kindA === 'tfplan') {
        notes.push(
          'Compared the planned values of a Terraform plan (`terraform show -json`), which is what the environment will be. HCL source is not parsed.',
        );
      }
      if (options.ignoreKeys.length > 0) {
        notes.push(`Ignored keys matching: ${options.ignoreKeys.join(', ')}.`);
      }
      if (suppressed > 0) {
        notes.push(
          `${suppressed} value${suppressed === 1 ? '' : 's'} differ only by a normalisation rule and are counted as unchanged.`,
        );
      }

      ctx.progress(100, 'done');

      return {
        engineId: 'env',
        summary: {
          added,
          removed,
          modified: changed,
          extra: {
            keys: rows.length,
            identical: same,
            secrets,
            // The strip renders `value label`, so this reads "env format" / "k8s
            // format" rather than the "read env file" the first version produced.
            format: kindA,
          },
          suppressed,
          radar: radarFrom({
            structure: ratioScore(added + removed, Math.max(1, rows.length)),
            content: ratioScore(changed, Math.max(1, rows.length)),
            // Secrets are metadata about the change: how much of what moved was
            // credential rather than configuration.
            metadata: ratioScore(secrets, Math.max(1, rows.length)),
          }),
        },
        data: { kind: kindA, rows, same, secrets },
        normalizationNotes: notes,
        timings: { ms: Date.now() - startedAt },
      };
    },
  };
}

export { SECRET_REASON_LABEL };
export type { ConfigKind, SecretReason };
