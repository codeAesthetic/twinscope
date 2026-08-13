import { describe, expect, it } from 'vitest';
import {
  breakingCount,
  differencePercent,
  evaluate,
  hasThresholds,
  NO_THRESHOLDS,
} from './thresholds';
import { parseArgs } from './args';
import type { Summary } from '../engines/types';

const summary = (over: Partial<Summary> = {}): Summary => ({
  added: 0,
  removed: 0,
  modified: 0,
  ...over,
});

const environment = { noColor: true, isTty: false };

describe('thresholds', () => {
  it('is inert when nothing was asked for', () => {
    expect(hasThresholds(NO_THRESHOLDS)).toBe(false);
    expect(evaluate(summary({ added: 500 }), NO_THRESHOLDS)).toEqual({
      failed: false,
      lines: [],
      failures: [],
    });
  });

  it('counts every kind of change against --max-changes', () => {
    const rules = { ...NO_THRESHOLDS, maxChanges: 3 };
    expect(evaluate(summary({ added: 1, removed: 1, modified: 1 }), rules).failed).toBe(false);
    expect(evaluate(summary({ added: 2, removed: 1, modified: 1 }), rules).failed).toBe(true);
  });

  it('reads the difference percentage out of the engine`s own extras', () => {
    expect(differencePercent(summary({ extra: { difference: '8.00%' } }))).toBe(8);
    expect(differencePercent(summary({ extra: { 'diff pixels': 12 } }))).toBe(12);
    expect(differencePercent(summary({ extra: { lines: 40 } }))).toBeUndefined();
  });

  it('fails a percentage threshold it cannot evaluate, rather than passing it', () => {
    // A build asking "fail over 1% different" against a comparison with no percentage
    // is a mistake in the pipeline. Passing silently would hide it forever.
    const result = evaluate(summary({ added: 1 }), { ...NO_THRESHOLDS, maxDiffPercent: 1 });
    expect(result.failed).toBe(true);
    expect(result.failures[0]).toMatch(/no difference percentage/);
  });

  it('fails --fail-on-breaking when the engine reports one, and when it reports none at all', () => {
    expect(breakingCount(summary({ extra: { breaking: 2 } }))).toBe(2);
    expect(
      evaluate(summary({ extra: { breaking: 2 } }), { ...NO_THRESHOLDS, failOnBreaking: true })
        .failed,
    ).toBe(true);
    expect(
      evaluate(summary({ extra: { breaking: 0 } }), { ...NO_THRESHOLDS, failOnBreaking: true })
        .failed,
    ).toBe(false);
    // No `breaking` key means the comparison never looked, which is not a pass.
    expect(evaluate(summary({ added: 1 }), { ...NO_THRESHOLDS, failOnBreaking: true }).failed).toBe(
      true,
    );
  });

  it('names every threshold in its lines, passing or failing', () => {
    const result = evaluate(summary({ added: 9, extra: { breaking: 0 } }), {
      maxChanges: 3,
      maxDiffPercent: undefined,
      failOnBreaking: true,
    });
    expect(result.lines).toHaveLength(2);
    expect(result.lines[0]).toMatch(/^FAIL/);
    expect(result.lines[1]).toMatch(/^ok/);
  });
});

describe('parsing the threshold flags', () => {
  const run = (argv: string[]) => parseArgs(argv, environment);

  it('accepts the three flags, with or without a percent sign', () => {
    const parsed = run([
      'a',
      'b',
      '--max-changes',
      '5',
      '--max-diff',
      '0.5%',
      '--fail-on-breaking',
    ]);
    expect(parsed.kind).toBe('run');
    if (parsed.kind !== 'run') return;
    expect(parsed.options.thresholds).toEqual({
      maxChanges: 5,
      maxDiffPercent: 0.5,
      failOnBreaking: true,
    });
  });

  it('refuses a threshold that is not a number', () => {
    // Silently becoming NaN would pass everything — the worst failure mode for a flag
    // whose entire job is to fail a build.
    expect(run(['a', 'b', '--max-changes', 'lots'])).toMatchObject({ kind: 'error' });
    expect(run(['a', 'b', '--max-diff'])).toMatchObject({ kind: 'error' });
    expect(run(['a', 'b', '--max-changes', '-3'])).toMatchObject({ kind: 'error' });
  });

  it('lists the thresholds and the exit-code caveat in --help', () => {
    const help = run(['--help']);
    expect(help.kind).toBe('help');
    if (help.kind !== 'help') return;
    for (const flag of ['--max-changes', '--max-diff', '--fail-on-breaking', '--github']) {
      expect(help.text).toContain(flag);
    }
    expect(help.text).toMatch(/threshold takes over exit code 1/);
  });
});
