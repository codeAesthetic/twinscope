import type { ReportInput, ReportRow } from './types';
import { formatDate, MARK_CLOSE, MARK_OPEN, total } from './types';

/**
 * Self-contained HTML report (MD §38).
 *
 * One file, no external requests — the recipient double-clicks it and it works
 * offline, which is the same promise the app itself makes. Everything is inlined:
 * CSS, and for the image report the images themselves as `data:` URLs.
 */

/**
 * The dark palette, copied from `renderer/src/styles/tokens.css`.
 *
 * A report cannot `@import` the app's stylesheet, so this is a copy — and
 * `html.test.ts` reads tokens.css and fails if the two ever disagree, which is
 * the only reason duplicating them is acceptable.
 */
export const REPORT_TOKENS: Record<string, string> = {
  '--bg': '#07090c',
  '--panel': '#0e1116',
  '--panel-2': '#12161d',
  '--line': '#1e2530',
  '--line-2': '#2a3340',
  '--tx': '#e7ebf2',
  '--tx-2': '#98a2b3',
  '--tx-3': '#68727f',
  '--acc': '#7c6cff',
  '--add': '#3fb950',
  '--add-bg': 'rgba(63, 185, 80, 0.1)',
  '--del': '#f8574f',
  '--del-bg': 'rgba(248, 87, 79, 0.1)',
  '--mod': '#e3b341',
  '--mod-bg': 'rgba(227, 179, 65, 0.1)',
  '--info': '#58a6ff',
};

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Renders ⟦…⟧ marks as highlighted spans, escaping everything else. */
function marked(text: string, tone: 'add' | 'del'): string {
  const parts = text.split(new RegExp(`${MARK_OPEN}|${MARK_CLOSE}`));
  return parts
    .map((part, index) =>
      index % 2 === 1 ? `<span class="w ${tone}">${escapeHtml(part)}</span>` : escapeHtml(part),
    )
    .join('');
}

function styles(): string {
  const variables = Object.entries(REPORT_TOKENS)
    .map(([name, value]) => `  ${name}: ${value};`)
    .join('\n');

  return `:root {
${variables}
  --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  --sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}
* { box-sizing: border-box; }
body { margin: 0; padding: 28px; background: var(--bg); color: var(--tx);
  font: 14px/1.5 var(--sans); }
main { max-width: 1100px; margin: 0 auto; }
h1 { font-size: 19px; margin: 0 0 4px; }
h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .09em;
  color: var(--tx-3); margin: 28px 0 10px; }
.meta { color: var(--tx-2); font-size: 12.5px; margin: 0 0 18px; }
.meta code { color: var(--tx); font-family: var(--mono); font-size: 12px; }
.chips { display: flex; flex-wrap: wrap; gap: 7px; margin: 0 0 6px; }
.chip { border: 1px solid var(--line-2); border-radius: 99px; padding: 3px 10px;
  font-size: 11.5px; color: var(--tx-2); }
.chip.add { color: var(--add); border-color: var(--add); background: var(--add-bg); }
.chip.del { color: var(--del); border-color: var(--del); background: var(--del-bg); }
.chip.mod { color: var(--mod); border-color: var(--mod); background: var(--mod-bg); }
.chip.info { color: var(--info); border-color: var(--info); }
.total { font-weight: 600; font-size: 15px; margin-right: 6px; }
ul.notes { color: var(--tx-3); font-size: 12.5px; padding-left: 18px; }

table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
th { text-align: left; color: var(--tx-3); font-weight: 600; font-size: 11px;
  text-transform: uppercase; letter-spacing: .06em; padding: 6px 8px;
  border-bottom: 1px solid var(--line-2); }
td { padding: 5px 8px; border-bottom: 1px solid var(--line); vertical-align: top;
  font-family: var(--mono); }
td.old { color: var(--del); text-decoration: line-through; }
td.new { color: var(--add); }
tr.add td { background: var(--add-bg); }
tr.del td { background: var(--del-bg); }
tr.mod td, tr.chg td { background: var(--mod-bg); }
tr.type td { background: rgba(88, 166, 255, .09); }

.diff { border: 1px solid var(--line); border-radius: 8px; overflow: hidden;
  background: var(--panel); font: 12px/20px var(--mono); }
.row { display: flex; }
.ln { width: 52px; flex: 0 0 auto; text-align: right; padding-right: 10px;
  color: var(--tx-3); border-right: 1px solid var(--line); user-select: none; }
.mk { width: 16px; flex: 0 0 auto; text-align: center; color: var(--tx-3); }
.tx { flex: 1; padding: 0 10px; white-space: pre-wrap; word-break: break-word; }
.row.add { background: var(--add-bg); } .row.add .mk { color: var(--add); }
.row.del { background: var(--del-bg); } .row.del .mk { color: var(--del); }
.row.fold { background: var(--panel-2); color: var(--tx-3); padding: 0 12px; }
.w { border-radius: 3px; padding: 0 1px; }
.w.add { background: rgba(63, 185, 80, .28); }
.w.del { background: rgba(248, 87, 79, .28); }

.tree { font-family: var(--mono); font-size: 12.5px; }
.tree .node { padding: 2px 0; }
.tree .k { color: var(--tx); }
.tree .v { color: var(--tx-2); }
.tree .v.old { color: var(--del); text-decoration: line-through; }
.tree .v.new { color: var(--add); }

.shots { display: flex; gap: 16px; flex-wrap: wrap; }
figure { margin: 0; }
figure img { max-width: 460px; width: 100%; border: 1px solid var(--line-2);
  border-radius: 8px; display: block; }
figcaption { color: var(--tx-3); font-size: 11px; text-transform: uppercase;
  letter-spacing: .09em; margin-top: 6px; }

footer { margin-top: 32px; padding-top: 14px; border-top: 1px solid var(--line);
  color: var(--tx-3); font-size: 11.5px; }

@media print {
  body { background: #fff; color: #111; }
  .diff, table { break-inside: avoid; }
  .row.add, tr.add td { background: #eaffea; }
  .row.del, tr.del td { background: #ffecec; }
  .chip { border-color: #bbb; color: #333; }
}`;
}

export function renderHtml(input: ReportInput): string {
  const { a, b, engineId, summary, generatedAt } = input;
  const title = `${a.name} ↔ ${b.name}`;

  const chips = [
    `<span class="total">${total(summary)} change${total(summary) === 1 ? '' : 's'}</span>`,
    `<span class="chip add">＋${summary.added} added</span>`,
    `<span class="chip del">－${summary.removed} removed</span>`,
    `<span class="chip mod">～${summary.modified} modified</span>`,
    ...Object.entries(summary.extra ?? {}).map(
      ([label, value]) =>
        `<span class="chip info">${escapeHtml(value)} ${escapeHtml(label)}</span>`,
    ),
    ...(summary.suppressed !== undefined && summary.suppressed > 0
      ? [`<span class="chip">${summary.suppressed} suppressed</span>`]
      : []),
  ].join('\n      ');

  const notes =
    input.normalizationNotes.length === 0
      ? ''
      : `<h2>Normalisation applied</h2>
    <ul class="notes">${input.normalizationNotes.map((note) => `<li>${escapeHtml(note)}</li>`).join('')}</ul>`;

  return `<!doctype html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>TwinScope — ${escapeHtml(title)}</title>
<style>
${styles()}
</style>
</head>
<body>
<main>
  <h1>${escapeHtml(title)}</h1>
  <p class="meta">
    <code>${escapeHtml(a.path ?? a.name)}</code> ↔ <code>${escapeHtml(b.path ?? b.name)}</code><br>
    ${escapeHtml(engineId)} engine · ${escapeHtml(formatDate(generatedAt))}
  </p>

  <div class="chips">
      ${chips}
  </div>
  ${notes}

  <h2>Changes</h2>
  ${bodyFor(input)}

  <footer>Generated locally by TwinScope. This file is self-contained — it makes no network requests.</footer>
</main>
</body>
</html>
`;
}

function bodyFor(input: ReportInput): string {
  switch (input.engineId) {
    case 'text':
      return textBody(input.data.rows ?? []);
    case 'json':
      return jsonBody(input.data.rows ?? []);
    // YAML (v0.2.3) and XML (v0.2.4) share the JSON core, so they share its report.
    case 'yaml':
    case 'xml':
      return jsonBody(input.data.rows ?? []);
    case 'folder':
      return folderBody(input.data.rows ?? []);
    case 'csv':
      return csvBody(input);
    case 'deps':
      return depsBody(input);
    case 'git':
      return gitBody(input);
    case 'image':
      return imageBody(input);
    default:
      return '<p class="meta">This engine has no HTML renderer.</p>';
  }
}

/** Folds are pre-expanded: a static report has no way to expand them later. */
function textBody(rows: readonly ReportRow[]): string {
  const flat: ReportRow[] = [];
  for (const row of rows) {
    if (row.kind === 'fold') {
      flat.push({ kind: 'fold', count: row.count });
      continue;
    }
    flat.push(row);
  }

  const html = flat
    .map((row) => {
      if (row.kind === 'fold') {
        return `<div class="row fold"><span class="tx">⋯ ${row.count} unchanged lines</span></div>`;
      }
      if (row.kind === 'mod') {
        return (
          `<div class="row del"><span class="ln">${row.left ?? ''}</span><span class="mk">−</span>` +
          `<span class="tx">${marked(row.text ?? '', 'del')}</span></div>` +
          `<div class="row add"><span class="ln">${row.right ?? ''}</span><span class="mk">+</span>` +
          `<span class="tx">${marked(row.textRight ?? '', 'add')}</span></div>`
        );
      }
      const cls = row.kind === 'add' ? 'add' : row.kind === 'del' ? 'del' : '';
      const mark = row.kind === 'add' ? '+' : row.kind === 'del' ? '−' : '';
      const number = row.kind === 'add' ? row.right : row.left;
      return (
        `<div class="row ${cls}"><span class="ln">${number ?? ''}</span>` +
        `<span class="mk">${mark}</span><span class="tx">${marked(row.text ?? '', cls === 'add' ? 'add' : 'del')}</span></div>`
      );
    })
    .join('\n    ');

  return `<div class="diff">\n    ${html}\n  </div>`;
}

function jsonBody(rows: readonly ReportRow[]): string {
  const changed = rows.filter((row) => row.container === undefined && row.state !== 'same');
  if (changed.length === 0) return '<p class="meta">No differences.</p>';

  const body = changed
    .map((row) => {
      const before = row.a ?? row.value;
      return (
        `<tr class="${escapeHtml(row.state)}">` +
        `<td>${escapeHtml(row.path)}</td>` +
        `<td>${escapeHtml(row.state === 'type' ? row.note : row.state)}</td>` +
        `<td class="old">${before === undefined ? '' : escapeHtml(before)}</td>` +
        `<td class="new">${row.b === undefined ? '' : escapeHtml(row.b)}</td></tr>`
      );
    })
    .join('\n      ');

  return `<table>
    <thead><tr><th>Path</th><th>Change</th><th>Before</th><th>After</th></tr></thead>
    <tbody>
      ${body}
    </tbody>
  </table>`;
}

function folderBody(rows: readonly ReportRow[]): string {
  const changed = rows.filter((row) => row.isDir !== true && row.status !== 'same');
  if (changed.length === 0) return '<p class="meta">No differences.</p>';

  const body = changed
    .map((row) => {
      const left = typeof row.left === 'object' ? row.left : undefined;
      const right = typeof row.right === 'object' ? row.right : undefined;
      return (
        `<tr class="${escapeHtml(row.status)}">` +
        `<td>${escapeHtml(row.path)}</td>` +
        `<td>${escapeHtml(row.status)}</td>` +
        `<td>${left?.size === undefined ? '—' : `${left.size} B`}</td>` +
        `<td>${right?.size === undefined ? '—' : `${right.size} B`}</td>` +
        `<td>${escapeHtml(row.note ?? '')}</td></tr>`
      );
    })
    .join('\n      ');

  return `<table>
    <thead><tr><th>File</th><th>Status</th><th>Before</th><th>After</th><th>Note</th></tr></thead>
    <tbody>
      ${body}
    </tbody>
  </table>`;
}

/**
 * The git report (v0.2.1): every changed file with its line counts.
 *
 * Every row in a git result is already a change, so unlike the folder report
 * there is nothing to filter out — a `same` row cannot exist.
 */
function gitBody(input: ReportInput): string {
  const rows = input.data.rows ?? [];
  const totals = input.data.totals ?? { added: 0, removed: 0 };
  if (rows.length === 0) return '<p class="meta">These two refs are identical.</p>';

  const body = rows
    .map((row) => {
      const counts =
        row.binary === true
          ? '<td colspan="2">binary</td>'
          : `<td class="new">＋${row.added ?? 0}</td><td class="old">－${row.removed ?? 0}</td>`;
      const from =
        row.oldPath === undefined
          ? ''
          : `from ${row.oldPath}${row.score === undefined ? '' : ` (${row.score}%)`}`;
      return (
        `<tr class="${escapeHtml(row.status)}">` +
        `<td>${escapeHtml(row.path)}</td>` +
        `<td>${escapeHtml(row.status)}</td>` +
        counts +
        `<td>${escapeHtml(from)}</td></tr>`
      );
    })
    .join('\n      ');

  return `<p class="meta">${escapeHtml(input.data.before?.label ?? '')} → ${escapeHtml(
    input.data.after?.label ?? '',
  )} in ${escapeHtml(input.data.repo ?? '')} · ＋${totals.added} －${totals.removed} lines${
    input.data.partial === true ? ' · partial' : ''
  }</p>
  <table>
    <thead><tr><th>File</th><th>Status</th><th>Added</th><th>Removed</th><th>Note</th></tr></thead>
    <tbody>
      ${body}
    </tbody>
  </table>`;
}

/**
 * The table report (v0.2.5).
 *
 * Changed rows only, and a changed cell shows both values — a static report has no
 * hover, so `old → new` in the cell is the only way to say what it was.
 */
function csvBody(input: ReportInput): string {
  const columns = (input.data.columns ?? []).filter((column) => column.ignored !== true);
  const rows = (input.data.rows ?? []).filter((row) => row.status !== 'same');
  if (rows.length === 0) return '<p class="meta">No rows differ.</p>';

  const head = columns.map((column) => `<th>${escapeHtml(column.name)}</th>`).join('');
  const body = rows
    .map((row) => {
      const cells = (row.cells ?? [])
        .filter((_, index) => (input.data.columns ?? [])[index]?.ignored !== true)
        .map((cell) => {
          if (cell.was === undefined) return `<td>${escapeHtml(cell.value)}</td>`;
          return (
            `<td class="new"><span class="old">${escapeHtml(cell.was)}</span> ` +
            `${escapeHtml(cell.value)}</td>`
          );
        })
        .join('');
      return (
        `<tr class="${escapeHtml(row.status)}">` +
        `<td>${row.before ?? '—'} → ${row.after ?? '—'}</td>${cells}</tr>`
      );
    })
    .join('\n      ');

  const paired =
    input.data.keyColumn === null || input.data.keyColumn === undefined
      ? 'paired by position'
      : `paired on ${escapeHtml(input.data.keyColumn)}`;

  return `<p class="meta">${input.data.counts?.before ?? 0} → ${input.data.counts?.after ?? 0} rows, ${paired}</p>
  <table>
    <thead><tr><th>Row</th>${head}</tr></thead>
    <tbody>
      ${body}
    </tbody>
  </table>`;
}

/**
 * The dependency report (v0.2.10). Changed packages only, with the bump and any
 * licence change — the three columns a reviewer reads.
 */
function depsBody(input: ReportInput): string {
  const rows = (input.data.rows ?? []).filter((row) => row.status !== 'same');
  if (rows.length === 0) return '<p class="meta">No dependency changed.</p>';

  const body = rows
    .map((row) => {
      const licence =
        row.licenseBefore !== undefined &&
        row.licenseAfter !== undefined &&
        row.licenseBefore !== row.licenseAfter
          ? `${escapeHtml(row.licenseBefore)} → ${escapeHtml(row.licenseAfter)}`
          : '';
      return (
        `<tr class="${escapeHtml(row.status)}">` +
        `<td>${escapeHtml(row.name)}</td>` +
        `<td>${escapeHtml(row.transitive === true ? 'transitive' : (row.kind ?? ''))}</td>` +
        `<td class="old">${row.before === undefined ? '' : escapeHtml(row.before)}</td>` +
        `<td class="new">${row.after === undefined ? '' : escapeHtml(row.after)}</td>` +
        `<td>${escapeHtml(row.bump ?? row.status)}</td>` +
        `<td>${licence}</td></tr>`
      );
    })
    .join('\n      ');

  const scope =
    input.data.resolved === true
      ? `${input.data.transitive?.before ?? 0} → ${input.data.transitive?.after ?? 0} packages resolved`
      : 'declared ranges only — compare the lockfiles for resolved versions and licences';

  return `<p class="meta">${escapeHtml(input.data.source?.before ?? '')} → ${escapeHtml(
    input.data.source?.after ?? '',
  )} · ${escapeHtml(scope)}</p>
  <table>
    <thead><tr><th>Package</th><th>Kind</th><th>Before</th><th>After</th><th>Change</th><th>Licence</th></tr></thead>
    <tbody>
      ${body}
    </tbody>
  </table>`;
}

function imageBody(input: ReportInput): string {
  const data = input.data;
  const images = input.images ?? {};

  const shots = (
    [
      ['Before', images.before],
      ['After', images.after],
      ['Difference', images.mask],
    ] as const
  )
    .filter(([, source]) => source !== undefined)
    .map(
      ([label, source]) =>
        `<figure><img alt="${label}" src="${escapeHtml(source)}"><figcaption>${label}</figcaption></figure>`,
    )
    .join('\n    ');

  const regions = (data.regions ?? [])
    .map(
      (region, index) =>
        `<tr><td>${index + 1}</td><td>${Math.round(region.left)}%, ${Math.round(region.top)}%</td>` +
        `<td>${Math.round(region.width)}% × ${Math.round(region.height)}%</td>` +
        `<td>${region.areaPct.toFixed(2)}%</td></tr>`,
    )
    .join('\n      ');

  return `<p class="meta"><strong>${(data.pct ?? 0).toFixed(2)}%</strong> of pixels differ —
    ${(data.diffPixels ?? 0).toLocaleString()} of ${(data.totalPixels ?? 0).toLocaleString()}.
    ${data.sameSize === false ? '<strong>Dimensions differ.</strong>' : ''}</p>
  <div class="shots">
    ${shots}
  </div>
  ${
    regions === ''
      ? ''
      : `<h2>Changed regions</h2>
  <table>
    <thead><tr><th>#</th><th>Position</th><th>Size</th><th>Area</th></tr></thead>
    <tbody>
      ${regions}
    </tbody>
  </table>`
  }`;
}
