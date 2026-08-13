/**
 * Argument parsing for the `twinscope` CLI (v0.2.2, MD §40).
 *
 * Hand-rolled rather than `commander`: the surface is two operands and nine
 * flags, and D28 says a dependency arrives with the feature that needs one. What
 * this buys is exact control over the two things a CLI is judged on — the wording
 * of an error and the exit code that comes with it — plus a parser that is a pure
 * function and therefore properly testable.
 */

export type OutputFormat = 'summary' | 'json' | 'md' | 'html' | 'patch';

export interface CliOptions {
  before: string;
  after: string;
  format: OutputFormat;
  /** Write the report here instead of to stdout. */
  out: string | undefined;
  /** Force an engine instead of letting detection decide (Rule 1: rarely). */
  engine: string | undefined;
  /** Present when the operands are git refs rather than paths. */
  repo: string | undefined;
  ignoreWhitespace: boolean;
  ignoreCase: boolean;
  color: boolean;
  quiet: boolean;
}

export type ParseResult =
  | { kind: 'run'; options: CliOptions }
  | { kind: 'help'; text: string }
  | { kind: 'version' }
  | { kind: 'error'; message: string };

export interface ParseEnvironment {
  /** `NO_COLOR` set to anything, per the informal standard. */
  noColor: boolean;
  /** False when stdout is a pipe or a file — escapes would end up in the bytes. */
  isTty: boolean;
}

const FORMAT_FLAGS: Record<string, OutputFormat> = {
  '--json': 'json',
  '--md': 'md',
  '--markdown': 'md',
  '--html': 'html',
  '--patch': 'patch',
};

export const HELP = `twinscope — compare anything, from the command line

USAGE
  twinscope <before> <after> [options]
  twinscope --repo <path> <ref> <ref> [options]

  Either operand may be - to read that side from stdin (one side only).

OPTIONS
  --json                 machine-readable result on stdout
  --md, --markdown       Markdown report
  --html                 self-contained HTML report
  --patch                unified diff (text comparisons only)
  --out <file>           write the report to a file instead of stdout
  --engine <id>          force an engine: text json folder git image binary
  --repo <path>          treat the operands as git refs in this repository
                         (use WORKTREE for the files as they are on disk)
  --ignore-whitespace    ignore whitespace-only changes
  --ignore-case          ignore case
  --no-color             never emit ANSI colour (also honours NO_COLOR)
  -q, --quiet            print nothing; rely on the exit code
  -h, --help             this text
  -v, --version          print the version

EXIT CODES
  0  the two inputs are the same
  1  they differ
  2  something went wrong

EXAMPLES
  twinscope before.json after.json
  twinscope src/ dist/ --md --out report.md
  twinscope --repo . main HEAD
  cat new.json | twinscope old.json -
`;

export function parseArgs(argv: readonly string[], environment: ParseEnvironment): ParseResult {
  const operands: string[] = [];
  let format: OutputFormat = 'summary';
  let out: string | undefined;
  let engine: string | undefined;
  let repo: string | undefined;
  let ignoreWhitespace = false;
  let ignoreCase = false;
  let quiet = false;
  // Colour is on when a human is looking at it and nothing says otherwise.
  let color = environment.isTty && !environment.noColor;
  let sawFormat = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] as string;

    if (arg === '-h' || arg === '--help') return { kind: 'help', text: HELP };
    if (arg === '-v' || arg === '--version') return { kind: 'version' };

    const asFormat = FORMAT_FLAGS[arg];
    if (asFormat !== undefined) {
      // Two formats is a mistake worth naming rather than resolving by order.
      if (sawFormat && asFormat !== format) {
        return { kind: 'error', message: 'Choose one output format, not several.' };
      }
      format = asFormat;
      sawFormat = true;
      continue;
    }

    if (arg === '--ignore-whitespace' || arg === '-w') {
      ignoreWhitespace = true;
      continue;
    }
    if (arg === '--ignore-case' || arg === '-i') {
      ignoreCase = true;
      continue;
    }
    if (arg === '--no-color' || arg === '--no-colour') {
      color = false;
      continue;
    }
    if (arg === '-q' || arg === '--quiet') {
      quiet = true;
      continue;
    }

    if (arg === '--out' || arg === '--engine' || arg === '--repo') {
      const value = argv[index + 1];
      // A missing value must not silently swallow the next flag, which is how
      // `--out --json a b` would otherwise write a file called "--json".
      if (value === undefined || (value.startsWith('-') && value !== '-')) {
        return { kind: 'error', message: `${arg} needs a value.` };
      }
      index += 1;
      if (arg === '--out') out = value;
      else if (arg === '--engine') engine = value;
      else repo = value;
      continue;
    }

    // `-` is stdin, not a flag. Anything else beginning with a dash is a typo,
    // and guessing at it is worse than saying so.
    if (arg.startsWith('-') && arg !== '-') {
      return { kind: 'error', message: `Unknown option ${arg}. Try --help.` };
    }

    operands.push(arg);
  }

  if (operands.length === 0) return { kind: 'help', text: HELP };
  if (operands.length === 1) {
    return { kind: 'error', message: 'Two things are needed to compare. Try --help.' };
  }
  if (operands.length > 2) {
    return {
      kind: 'error',
      message: `Expected two things to compare, got ${operands.length}. Try --help.`,
    };
  }

  const [before, after] = operands as [string, string];

  if (before === '-' && after === '-') {
    return { kind: 'error', message: 'Only one side can come from stdin.' };
  }
  if (repo !== undefined && (before === '-' || after === '-')) {
    return { kind: 'error', message: 'Git refs cannot come from stdin.' };
  }

  return {
    kind: 'run',
    options: {
      before,
      after,
      format,
      out,
      engine,
      repo,
      ignoreWhitespace,
      ignoreCase,
      color,
      quiet,
    },
  };
}
