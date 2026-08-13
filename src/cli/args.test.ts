import { describe, expect, it } from 'vitest';
import { parseArgs, HELP, type ParseEnvironment } from './args';

const TTY: ParseEnvironment = { noColor: false, isTty: true };
const PIPE: ParseEnvironment = { noColor: false, isTty: false };

/** Narrows to the `run` case so a failed parse fails the test, not the types. */
function run(argv: string[], environment: ParseEnvironment = TTY) {
  const parsed = parseArgs(argv, environment);
  if (parsed.kind !== 'run') throw new Error(`expected a run, got ${parsed.kind}`);
  return parsed.options;
}

describe('parseArgs', () => {
  it('takes two operands and defaults to a human summary', () => {
    expect(run(['a.json', 'b.json'])).toMatchObject({
      before: 'a.json',
      after: 'b.json',
      format: 'summary',
      out: undefined,
      engine: undefined,
      repo: undefined,
      quiet: false,
    });
  });

  it('reads each output format, including the alias', () => {
    expect(run(['a', 'b', '--json']).format).toBe('json');
    expect(run(['a', 'b', '--md']).format).toBe('md');
    expect(run(['a', 'b', '--markdown']).format).toBe('md');
    expect(run(['a', 'b', '--html']).format).toBe('html');
    expect(run(['a', 'b', '--patch']).format).toBe('patch');
  });

  it('refuses two different formats rather than letting order decide', () => {
    expect(parseArgs(['a', 'b', '--md', '--html'], TTY)).toEqual({
      kind: 'error',
      message: 'Choose one output format, not several.',
    });
    // The same one twice is not a mistake.
    expect(run(['a', 'b', '--md', '--md']).format).toBe('md');
  });

  it('reads the value-taking flags', () => {
    expect(run(['a', 'b', '--out', 'r.md', '--engine', 'text', '--repo', '/tmp/x'])).toMatchObject({
      out: 'r.md',
      engine: 'text',
      repo: '/tmp/x',
    });
  });

  it('will not let a missing value swallow the next flag', () => {
    // `--out --json a b` must not write a file called "--json".
    expect(parseArgs(['--out', '--json', 'a', 'b'], TTY)).toEqual({
      kind: 'error',
      message: '--out needs a value.',
    });
    expect(parseArgs(['a', 'b', '--engine'], TTY)).toEqual({
      kind: 'error',
      message: '--engine needs a value.',
    });
  });

  it('accepts - as a value, since it is a filename here and not a flag', () => {
    expect(run(['-', 'b.json']).before).toBe('-');
    expect(run(['a.json', '-']).after).toBe('-');
  });

  it('allows only one side to be stdin', () => {
    expect(parseArgs(['-', '-'], TTY)).toEqual({
      kind: 'error',
      message: 'Only one side can come from stdin.',
    });
  });

  it('refuses stdin for git refs, which are not file content', () => {
    expect(parseArgs(['--repo', '.', '-', 'main'], TTY)).toMatchObject({ kind: 'error' });
  });

  it('reads the boolean flags and their short forms', () => {
    expect(run(['a', 'b', '--ignore-whitespace', '--ignore-case'])).toMatchObject({
      ignoreWhitespace: true,
      ignoreCase: true,
    });
    expect(run(['a', 'b', '-w', '-i'])).toMatchObject({
      ignoreWhitespace: true,
      ignoreCase: true,
    });
    expect(run(['a', 'b', '-q']).quiet).toBe(true);
    expect(run(['a', 'b', '--quiet']).quiet).toBe(true);
  });

  it('colours for a terminal and never for a pipe', () => {
    // A report redirected into a file must not contain escape sequences.
    expect(run(['a', 'b']).color).toBe(true);
    expect(run(['a', 'b'], PIPE).color).toBe(false);
    expect(run(['a', 'b'], { noColor: true, isTty: true }).color).toBe(false);
    expect(run(['a', 'b', '--no-color']).color).toBe(false);
    expect(run(['a', 'b', '--no-colour']).color).toBe(false);
  });

  it('shows help for --help, -h and no arguments at all', () => {
    expect(parseArgs(['--help'], TTY)).toEqual({ kind: 'help', text: HELP });
    expect(parseArgs(['-h'], TTY)).toEqual({ kind: 'help', text: HELP });
    expect(parseArgs([], TTY)).toEqual({ kind: 'help', text: HELP });
  });

  it('answers --version before it validates anything else', () => {
    expect(parseArgs(['--version'], TTY)).toEqual({ kind: 'version' });
    expect(parseArgs(['-v', 'nonsense', 'more', 'even-more'], TTY)).toEqual({ kind: 'version' });
  });

  it('counts operands rather than guessing which one was meant', () => {
    expect(parseArgs(['only.json'], TTY)).toEqual({
      kind: 'error',
      message: 'Two things are needed to compare. Try --help.',
    });
    expect(parseArgs(['a', 'b', 'c'], TTY)).toEqual({
      kind: 'error',
      message: 'Expected two things to compare, got 3. Try --help.',
    });
  });

  it('names an unknown option instead of ignoring it', () => {
    expect(parseArgs(['a', 'b', '--htlm'], TTY)).toEqual({
      kind: 'error',
      message: 'Unknown option --htlm. Try --help.',
    });
  });

  it('documents every flag it accepts', () => {
    // A flag that works but is undocumented is a flag nobody uses. Checked
    // mechanically so the help text cannot drift away from the parser.
    for (const flag of [
      '--json',
      '--md',
      '--html',
      '--patch',
      '--out',
      '--engine',
      '--repo',
      '--ignore-whitespace',
      '--ignore-case',
      '--no-color',
      '--quiet',
      '--help',
      '--version',
    ]) {
      expect(HELP, flag).toContain(flag);
    }
  });
});
