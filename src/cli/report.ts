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

  return `${lines.join('\n')}\n`;
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
    },
    null,
    2,
  )}\n`;
}
