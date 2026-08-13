import type { DiffResult, InputRef, Summary } from '../engines/types';

/**
 * What the CLI prints (v0.2.2).
 *
 * Pure: it takes a result and returns a string, so every line of output is unit
 * tested rather than eyeballed. The report *files* are not rendered here — those
 * come from `shared/report/`, unchanged, which is the point of that module living
 * in `shared/` rather than in `main/`.
 */

const ANSI = {
  reset: '\u001b[0m',
  dim: '\u001b[2m',
  bold: '\u001b[1m',
  green: '\u001b[32m',
  red: '\u001b[31m',
  yellow: '\u001b[33m',
  cyan: '\u001b[36m',
};

export interface Paint {
  (text: string, code: keyof typeof ANSI): string;
}

/** One place decides whether colour happens, so no call site has to remember. */
export function painter(color: boolean): Paint {
  if (!color) return (text) => text;
  return (text, code) => `${ANSI[code]}${text}${ANSI.reset}`;
}

export function isIdentical(summary: Summary): boolean {
  return summary.added === 0 && summary.removed === 0 && summary.modified === 0;
}

/**
 * The default output: what changed, how the engine was chosen, and what
 * normalisation did — Rule 3 applies to a terminal exactly as it does to the UI.
 */
export function renderSummary(
  result: DiffResult,
  a: InputRef,
  b: InputRef,
  engineLabel: string,
  paint: Paint,
  /** Present when a threshold was given (v0.3.4). */
  thresholds?: { failed: boolean; lines: string[]; failures: string[] },
): string {
  const { summary } = result;
  const lines: string[] = [];

  lines.push(`${paint(a.name, 'bold')} ${paint('→', 'dim')} ${paint(b.name, 'bold')}`);
  lines.push(paint(`${engineLabel} · ${result.timings.ms} ms`, 'dim'));
  lines.push('');

  if (isIdentical(summary)) {
    lines.push(paint('No differences.', 'green'));
  } else {
    lines.push(
      [
        paint(`+${summary.added} added`, 'green'),
        paint(`-${summary.removed} removed`, 'red'),
        paint(`~${summary.modified} modified`, 'yellow'),
      ].join('  '),
    );
  }

  const extra = summary.extra ?? {};
  const extras = Object.entries(extra).map(([key, value]) => `${key}: ${value}`);
  if (summary.suppressed !== undefined && summary.suppressed > 0) {
    extras.push(`suppressed: ${summary.suppressed}`);
  }
  if (extras.length > 0) lines.push(paint(extras.join('  ·  '), 'cyan'));

  if (result.normalizationNotes.length > 0) {
    lines.push('');
    for (const note of result.normalizationNotes) lines.push(paint(`• ${note}`, 'dim'));
  }

  // The threshold verdict goes last and names each rule, so a failing build says
  // which number it failed on rather than only that it failed.
  if (thresholds !== undefined && thresholds.lines.length > 0) {
    lines.push('');
    for (const line of thresholds.lines) {
      lines.push(line.startsWith('FAIL') ? paint(line, 'red') : paint(line, 'green'));
    }
  }

  return `${lines.join('\n')}\n`;
}

/**
 * `--format github` (v0.3.4): annotations for the log, Markdown for the job summary.
 *
 * Two outputs because GitHub reads two places, and a CI integration whose whole output
 * is a wall of stdout is one nobody reads. Annotations go to stdout, where the runner
 * parses them; the summary is returned separately for the caller to append to
 * `$GITHUB_STEP_SUMMARY`.
 */
export function renderGithub(
  result: DiffResult,
  a: InputRef,
  b: InputRef,
  engineLabel: string,
  thresholds: { failed: boolean; lines: string[]; failures: string[] },
): { annotations: string; summary: string } {
  const { summary } = result;
  const changes = summary.added + summary.removed + summary.modified;
  const title = `${a.name} → ${b.name}`;
  const counts = `+${summary.added} / -${summary.removed} / ~${summary.modified}`;

  const annotations: string[] = [];
  for (const failure of thresholds.failures) {
    // `::error` with no file attaches the annotation to the step, which is right: a
    // comparison is about two files, and pinning it to one of them would be a guess.
    annotations.push(`::error title=TwinScope threshold::${escapeData(failure)} (${title})`);
  }
  if (thresholds.failures.length === 0) {
    annotations.push(
      `::notice title=TwinScope::${escapeData(`${title}: ${changes} change${changes === 1 ? '' : 's'} (${counts})`)}`,
    );
  }

  const extras = Object.entries(summary.extra ?? {}).map(([key, value]) => `${key}: ${value}`);
  const lines = [
    `### TwinScope — ${title}`,
    '',
    `**${changes} change${changes === 1 ? '' : 's'}** · ${counts} · ${engineLabel} · ${result.timings.ms} ms`,
    '',
  ];
  if (extras.length > 0) lines.push(extras.map((entry) => `\`${entry}\``).join(' '), '');
  if (thresholds.lines.length > 0) {
    lines.push('| Threshold | Result |', '| --- | --- |');
    for (const line of thresholds.lines) {
      const failed = line.startsWith('FAIL');
      lines.push(`| ${escapePipes(line.replace(/^(ok|FAIL)\s+/, ''))} | ${failed ? '❌' : '✅'} |`);
    }
    lines.push('');
  }
  if (result.normalizationNotes.length > 0) {
    lines.push('<details><summary>What the comparison did</summary>', '');
    for (const note of result.normalizationNotes) lines.push(`- ${note}`);
    lines.push('', '</details>', '');
  }

  return { annotations: `${annotations.join('\n')}\n`, summary: `${lines.join('\n')}\n` };
}

/** GitHub's workflow-command escaping: a newline in a message would end the command. */
function escapeData(value: string): string {
  return value.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

function escapePipes(value: string): string {
  return value.replace(/\|/g, '\\|');
}

/**
 * `--json`. The engine's own `data` is deliberately **not** included: it is a
 * different shape per engine and, for a 50k-row diff, megabytes of it. A caller
 * who wants the rows wants `--md` or `--html`.
 */
export function renderJson(
  result: DiffResult,
  a: InputRef,
  b: InputRef,
  engineLabel: string,
  /** Present when a threshold was given (v0.3.4), so a pipeline can read the verdict. */
  thresholds?: { failed: boolean; lines: string[]; failures: string[] },
): string {
  return `${JSON.stringify(
    {
      before: { name: a.name, path: a.path ?? null, kind: a.kind, ref: a.ref ?? null },
      after: { name: b.name, path: b.path ?? null, kind: b.kind, ref: b.ref ?? null },
      engine: { id: result.engineId, label: engineLabel },
      summary: result.summary,
      normalizationNotes: result.normalizationNotes,
      identical: isIdentical(result.summary),
      ms: result.timings.ms,
      ...(thresholds === undefined ? {} : { thresholds }),
    },
    null,
    2,
  )}\n`;
}
