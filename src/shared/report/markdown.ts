import type { ReportInput } from './types';
import { changeRows, formatDate, MARK_CLOSE, MARK_OPEN, total } from './types';

/**
 * Markdown report (MD §39).
 *
 * Plain enough to paste into a pull request or a ticket, which is the whole
 * point — the recipient needs nothing installed, and GitHub renders the diff
 * block with colour for free.
 *
 * Lives in `shared/` because the CLI (v0.2.2) renders the same reports.
 */
export function renderMarkdown(input: ReportInput): string {
  const { a, b, engineId, summary, options, generatedAt } = input;

  const lines: string[] = [
    `# ${a.name} ↔ ${b.name}`,
    '',
    `| | |`,
    `|---|---|`,
    `| Before | \`${a.path ?? a.name}\` |`,
    `| After | \`${b.path ?? b.name}\` |`,
    `| Engine | ${engineId} |`,
    `| Generated | ${formatDate(generatedAt)} |`,
  ];

  if (Object.keys(options).length > 0) {
    lines.push(`| Options | ${describeOptions(options)} |`);
  }

  lines.push(
    '',
    '## Summary',
    '',
    `**${total(summary)} change${total(summary) === 1 ? '' : 's'}** — ` +
      `${summary.added} added, ${summary.removed} removed, ${summary.modified} modified` +
      (summary.suppressed !== undefined && summary.suppressed > 0
        ? ` · ${summary.suppressed} suppressed by normalisation`
        : ''),
  );

  const extra = Object.entries(summary.extra ?? {});
  if (extra.length > 0) {
    lines.push('', extra.map(([label, value]) => `${value} ${label}`).join(' · '));
  }

  if (input.normalizationNotes.length > 0) {
    lines.push('', '### Normalisation applied', '');
    for (const note of input.normalizationNotes) lines.push(`- ${note}`);
  }

  lines.push('', '## Changes', '', ...body(input));
  lines.push('', '---', '', '_Generated locally by TwinScope. No data left this machine._');

  return `${lines.join('\n')}\n`;
}

function describeOptions(options: Record<string, unknown>): string {
  return Object.entries(options)
    .map(([key, value]) => `\`${key}: ${JSON.stringify(value)}\``)
    .join(', ');
}

/** Each engine's body is the shape a reader of *that* comparison expects. */
function body(input: ReportInput): string[] {
  switch (input.engineId) {
    case 'text':
      return textBody(input);
    case 'json':
      return jsonBody(input);
    case 'folder':
      return folderBody(input);
    case 'git':
      return gitBody(input);
    case 'image':
      return imageBody(input);
    default:
      return ['_This engine has no Markdown renderer._'];
  }
}

function strip(text: string): string {
  return text.split(MARK_OPEN).join('').split(MARK_CLOSE).join('');
}

/** A fenced `diff` block: universally rendered, and copy-pastes back as a patch. */
function textBody(input: ReportInput): string[] {
  const rows = input.data.rows ?? [];
  const out: string[] = ['```diff'];

  for (const row of rows) {
    if (row.kind === 'fold') {
      out.push(`@@ ${row.count} unchanged lines @@`);
      continue;
    }
    if (row.kind === 'mod') {
      out.push(`-${strip(row.text ?? '')}`);
      out.push(`+${strip(row.textRight ?? '')}`);
      continue;
    }
    const prefix = row.kind === 'add' ? '+' : row.kind === 'del' ? '-' : ' ';
    out.push(`${prefix}${strip(row.text ?? '')}`);
  }

  out.push('```');
  return out;
}

/** A table, because what a reader wants from a JSON diff is path → before → after. */
function jsonBody(input: ReportInput): string[] {
  const rows = (input.data.rows ?? []).filter(
    (row) => row.container === undefined && row.state !== 'same',
  );
  if (rows.length === 0) return ['_No differences._'];

  const out = ['| Path | Change | Before | After |', '|---|---|---|---|'];
  for (const row of rows) {
    const change =
      row.state === 'add'
        ? 'added'
        : row.state === 'del'
          ? 'removed'
          : row.state === 'type'
            ? `type (${row.note ?? ''})`
            : row.state === 'ign'
              ? 'ignored'
              : 'changed';
    out.push(
      `| \`${row.path ?? ''}\` | ${change} | ${cell(row.a ?? row.value)} | ${cell(row.b)} |`,
    );
  }
  return out;
}

function folderBody(input: ReportInput): string[] {
  const rows = (input.data.rows ?? []).filter((row) => row.isDir !== true && row.status !== 'same');
  if (rows.length === 0) return ['_No differences._'];

  const out = ['| File | Status | Before | After | Note |', '|---|---|---|---|---|'];
  for (const row of rows) {
    // `left`/`right` are line numbers in a text row and side records in a folder
    // row; only the second shape has a size.
    const left = typeof row.left === 'object' ? row.left : undefined;
    const right = typeof row.right === 'object' ? row.right : undefined;
    out.push(
      `| \`${row.path ?? ''}\` | ${row.status ?? ''} | ${size(left?.size)} | ${size(right?.size)} | ${row.note ?? ''} |`,
    );
  }
  return out;
}

/** The git report (v0.2.1). Every row is a change, so nothing is filtered out. */
function gitBody(input: ReportInput): string[] {
  const rows = input.data.rows ?? [];
  const totals = input.data.totals ?? { added: 0, removed: 0 };
  if (rows.length === 0) return ['_These two refs are identical._'];

  const out = [
    `\`${input.data.before?.label ?? ''}\` → \`${input.data.after?.label ?? ''}\` in ` +
      `\`${input.data.repo ?? ''}\` — **＋${totals.added} －${totals.removed}** lines` +
      (input.data.partial === true ? ' _(partial)_' : ''),
    '',
    '| File | Status | Added | Removed | Note |',
    '|---|---|---|---|---|',
  ];

  for (const row of rows) {
    const counts =
      row.binary === true ? ['binary', 'binary'] : [`${row.added ?? 0}`, `${row.removed ?? 0}`];
    const from =
      row.oldPath === undefined
        ? ''
        : `from \`${row.oldPath}\`${row.score === undefined ? '' : ` (${row.score}%)`}`;
    out.push(
      `| \`${row.path ?? ''}\` | ${row.status ?? ''} | ${counts[0]} | ${counts[1]} | ${from} |`,
    );
  }

  return out;
}

function imageBody(input: ReportInput): string[] {
  const data = input.data;
  const out = [
    `**${(data.pct ?? 0).toFixed(2)}%** of pixels differ ` +
      `(${(data.diffPixels ?? 0).toLocaleString()} of ${(data.totalPixels ?? 0).toLocaleString()}).`,
    '',
    `Dimensions: ${(data.dims?.before ?? []).join('×')} → ${(data.dims?.after ?? []).join('×')}` +
      (data.sameSize === false ? ' — **size mismatch**' : ''),
  ];

  const regions = data.regions ?? [];
  if (regions.length > 0) {
    out.push('', '| Region | Position | Size | Area |', '|---|---|---|---|');
    regions.forEach((region, index) => {
      out.push(
        `| ${index + 1} | ${Math.round(region.left)}%, ${Math.round(region.top)}% ` +
          `| ${Math.round(region.width)}% × ${Math.round(region.height)}% ` +
          `| ${region.areaPct.toFixed(2)}% |`,
      );
    });
  }

  // Images are deliberately absent: a Markdown report has nowhere to put them
  // that does not depend on a file the recipient may not have. The HTML report
  // embeds them instead.
  return out;
}

function cell(value: unknown): string {
  if (value === undefined) return '—';
  return `\`${String(value).replace(/\|/g, '\\|')}\``;
}

function size(bytes: number | undefined): string {
  if (bytes === undefined) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Unified patch text, for "copy diff to clipboard" (MD A21). */
export function renderUnifiedPatch(input: ReportInput): string {
  if (input.engineId !== 'text') return renderMarkdown(input);

  const header = [`--- ${input.a.path ?? input.a.name}`, `+++ ${input.b.path ?? input.b.name}`];
  const body = textBody(input).filter((line) => !line.startsWith('```'));
  return `${[...header, ...body].join('\n')}\n`;
}

/** Re-exported so callers do not have to know where the row helpers live. */
export { changeRows };
