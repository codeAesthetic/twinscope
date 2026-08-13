import { appendFile, writeFile } from 'node:fs/promises';
import { parseArgs, type CliOptions } from './args';
import { cliGitHost, cliHostFs, cliImageHost, cliPdfHost } from './hosts';
import { CliInputError, readStdin, resolveInput } from './inputs';
import { isIdentical, painter, renderGithub, renderJson, renderSummary } from './report';
import { evaluate, hasThresholds } from './thresholds';
import { engineById, selectEngine } from '../engines/registry';
import { EngineInputError } from '../engines/types';
import { renderHtml } from '../shared/report/html';
import { renderMarkdown, renderUnifiedPatch } from '../shared/report/markdown';
import type { DiffEngine, DiffResult, EngineCtx, InputRef } from '../engines/types';
import type { ReportInput } from '../shared/report/types';

/**
 * `twinscope` — the command line (v0.2.2, MD §40, A22).
 *
 * The whole point of this file is how little it contains. Every engine, every
 * report renderer and the detection rules are the ones the desktop app runs; what
 * the CLI adds is argument parsing, three host implementations, and an exit code.
 * That is only possible because `src/engines/` never imported `electron` and
 * `shared/report/` never imported `main/` — a boundary held since SETUP-5 for
 * exactly this moment.
 *
 * No engine host process, either: a CLI has nothing to keep responsive, so the
 * comparison runs inline and cancellation is whatever the user's ^C already does.
 */

/** Injected at build time — a bundled file cannot reliably find package.json. */
declare const __TWINSCOPE_VERSION__: string;

export const EXIT = { same: 0, different: 1, error: 2 } as const;

export async function main(argv: readonly string[]): Promise<number> {
  const parsed = parseArgs(argv, {
    noColor: process.env['NO_COLOR'] !== undefined && process.env['NO_COLOR'] !== '',
    isTty: process.stdout.isTTY === true,
  });

  if (parsed.kind === 'help') {
    process.stdout.write(parsed.text);
    return EXIT.same;
  }
  if (parsed.kind === 'version') {
    process.stdout.write(`${__TWINSCOPE_VERSION__}\n`);
    return EXIT.same;
  }
  if (parsed.kind === 'error') {
    process.stderr.write(`twinscope: ${parsed.message}\n`);
    return EXIT.error;
  }

  try {
    return await run(parsed.options);
  } catch (cause) {
    // An engine that offers a way out says so here too: the app renders it as a
    // button, and the terminal can only suggest the flag that does the same.
    const hint =
      cause instanceof EngineInputError && cause.fallback !== undefined
        ? ` Try --engine ${cause.fallback.fallbackEngineId}.`
        : '';
    const message = cause instanceof Error ? cause.message : String(cause);
    process.stderr.write(`twinscope: ${message}${hint}\n`);
    return EXIT.error;
  }
}

async function run(options: CliOptions): Promise<number> {
  const stdin = options.before === '-' || options.after === '-' ? await readStdin() : undefined;

  const [a, b] = await Promise.all([
    resolveInput({
      side: 'A',
      operand: options.before,
      repo: options.repo,
      ...(options.before === '-' ? { stdin } : {}),
    }),
    resolveInput({
      side: 'B',
      operand: options.after,
      repo: options.repo,
      ...(options.after === '-' ? { stdin } : {}),
    }),
  ]);

  const engine = pickEngine(a, b, options.engine);
  const result = await compare(engine, a, b, options);
  const thresholds = evaluate(result.summary, options.thresholds);

  await emit(result, a, b, engine, options, thresholds);

  // A threshold takes over the exit code (v0.3.4). Without one, exit 1 means "these
  // differ", which is usually true and rarely a build failure; with one it means
  // "these differ by more than you allowed". Conflating the two silently would make
  // one of them a trap.
  if (hasThresholds(options.thresholds)) return thresholds.failed ? EXIT.different : EXIT.same;
  return isIdentical(result.summary) ? EXIT.same : EXIT.different;
}

function pickEngine(a: InputRef, b: InputRef, forced: string | undefined): DiffEngine<unknown> {
  if (forced !== undefined) {
    const named = engineById(forced);
    if (named === undefined) throw new CliInputError(`There is no "${forced}" engine.`);
    return named;
  }

  const detected = selectEngine(a, b);
  if (detected === undefined) {
    throw new CliInputError(`Nothing can compare ${a.kind} against ${b.kind}.`);
  }
  return detected;
}

async function compare(
  engine: DiffEngine<unknown>,
  a: InputRef,
  b: InputRef,
  options: CliOptions,
): Promise<DiffResult> {
  const controller = new AbortController();
  const ctx: EngineCtx = {
    signal: controller.signal,
    // Nothing to draw a progress bar with that would not fight the report on
    // stdout, so progress is dropped rather than half-implemented.
    progress: () => undefined,
    fs: cliHostFs,
    image: cliImageHost,
    git: cliGitHost,
    pdf: cliPdfHost,
  };

  const defaults = engine.defaultOptions() as Record<string, unknown>;
  const engineOptions: Record<string, unknown> = { ...defaults };
  // Only set what the user asked for, and only where the engine has the option —
  // handing `ignoreCase` to the folder engine would be meaningless noise.
  if (options.ignoreWhitespace && 'ignoreWhitespace' in defaults) {
    engineOptions.ignoreWhitespace = true;
  }
  if (options.ignoreCase && 'ignoreCase' in defaults) engineOptions.ignoreCase = true;

  return engine.compare(a, b, engineOptions, ctx);
}

async function emit(
  result: DiffResult,
  a: InputRef,
  b: InputRef,
  engine: DiffEngine<unknown>,
  options: CliOptions,
  thresholds: ReturnType<typeof evaluate>,
): Promise<void> {
  const label = engine.meta.label;

  if (options.format === 'github') {
    if (options.quiet) return;
    const { annotations, summary } = renderGithub(result, a, b, label, thresholds);
    process.stdout.write(annotations);
    // The job summary goes to the file the runner gave us, when it gave us one —
    // appended, because a step may write several comparisons into one summary.
    const target = options.out ?? process.env['GITHUB_STEP_SUMMARY'];
    if (target !== undefined && target !== '') await appendFile(target, summary, 'utf8');
    else process.stdout.write(summary);
    return;
  }

  if (options.format === 'summary' || options.format === 'json') {
    if (options.quiet) return;
    const withThresholds = hasThresholds(options.thresholds) ? thresholds : undefined;
    const text =
      options.format === 'json'
        ? renderJson(result, a, b, label, withThresholds)
        : renderSummary(result, a, b, label, painter(options.color), withThresholds);
    // Even `--json` honours `--out`: writing a machine-readable result to a file
    // is exactly what a CI step wants.
    if (options.out !== undefined) await writeFile(options.out, text, 'utf8');
    else process.stdout.write(text);
    return;
  }

  const report = reportInput(result, a, b);
  const rendered =
    options.format === 'html'
      ? renderHtml(report)
      : options.format === 'patch'
        ? renderUnifiedPatch(report)
        : renderMarkdown(report);

  if (options.out !== undefined) {
    await writeFile(options.out, rendered, 'utf8');
    if (!options.quiet) process.stderr.write(`twinscope: wrote ${options.out}\n`);
    return;
  }
  if (!options.quiet) process.stdout.write(rendered);
}

/**
 * The same `ReportInput` the app builds, so the files are byte-identical for the
 * same comparison. Images are the one thing missing: the app embeds `data:` URLs
 * produced by the view, and the CLI does not run a view.
 */
function reportInput(result: DiffResult, a: InputRef, b: InputRef): ReportInput {
  const side = (ref: InputRef) => ({
    name: ref.name,
    kind: ref.kind,
    ...(ref.path !== undefined ? { path: ref.path } : {}),
  });

  return {
    a: side(a),
    b: side(b),
    engineId: result.engineId,
    summary: result.summary,
    options: {},
    normalizationNotes: result.normalizationNotes,
    generatedAt: new Date().toISOString(),
    data: result.data as ReportInput['data'],
  };
}

// `require.main` rather than an import.meta check: the package is CommonJS (§7),
// and this guard is what lets the unit tests import `main()` without running it.
if (require.main === module) {
  void main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
