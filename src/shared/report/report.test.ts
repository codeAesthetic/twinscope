import { describe, expect, it } from 'vitest';
import { renderHtml } from './html';
import { renderMarkdown, renderUnifiedPatch } from './markdown';
import type { ReportInput } from './types';

const BASE: ReportInput = {
  a: { name: 'before.txt', path: '/tmp/before.txt', kind: 'text' },
  b: { name: 'after.txt', path: '/tmp/after.txt', kind: 'text' },
  engineId: 'text',
  summary: { added: 1, removed: 1, modified: 1, extra: { lines: 4 } },
  options: { ignoreWhitespace: true },
  normalizationNotes: ['Normalised line endings (CRLF → LF).'],
  generatedAt: '2026-08-12T10:30:00.000Z',
  data: {
    rows: [
      { kind: 'ctx', left: 1, right: 1, text: 'shared line' },
      { kind: 'mod', left: 2, right: 2, text: 'value ⟦one⟧', textRight: 'value ⟦two⟧' },
      { kind: 'del', left: 3, text: 'gone' },
      { kind: 'add', right: 3, text: 'fresh' },
      { kind: 'fold', count: 12 },
    ],
  },
};

const JSON_REPORT: ReportInput = {
  ...BASE,
  engineId: 'json',
  a: { name: 'a.json', kind: 'json' },
  b: { name: 'b.json', kind: 'json' },
  summary: { added: 1, removed: 0, modified: 2, suppressed: 1 },
  data: {
    rows: [
      { depth: 0, key: '$', path: '$', state: 'chg', container: 'obj' },
      { depth: 1, key: 'name', path: '$.name', state: 'chg', a: '"one"', b: '"two"' },
      {
        depth: 1,
        key: 'age',
        path: '$.age',
        state: 'type',
        a: '27',
        b: '"27"',
        note: 'number → string',
      },
      { depth: 1, key: 'phone', path: '$.phone', state: 'add', b: '"+1"' },
      { depth: 1, key: 'kept', path: '$.kept', state: 'same', value: '1' },
    ],
  },
};

const FOLDER_REPORT: ReportInput = {
  ...BASE,
  engineId: 'folder',
  a: { name: 'before/', path: '/tmp/before', kind: 'folder' },
  b: { name: 'after/', path: '/tmp/after', kind: 'folder' },
  summary: { added: 1, removed: 0, modified: 1, extra: { identical: 3 } },
  data: {
    rows: [
      { depth: 0, path: 'src', isDir: true, status: 'mod' },
      {
        depth: 1,
        path: 'src/edit.ts',
        isDir: false,
        status: 'mod',
        left: { name: 'edit.ts', status: 'mod', size: 100 },
        right: { name: 'edit.ts', status: 'mod', size: 220 },
      },
      {
        depth: 1,
        path: 'src/keep.ts',
        isDir: false,
        status: 'same',
        left: { name: 'keep.ts', status: 'same', size: 10 },
        right: { name: 'keep.ts', status: 'same', size: 10 },
      },
    ],
  },
};

const GIT_REPORT: ReportInput = {
  ...BASE,
  engineId: 'git',
  a: { name: 'repo @ main', path: '/tmp/repo', kind: 'git' },
  b: { name: 'repo @ working tree', path: '/tmp/repo', kind: 'git' },
  summary: { added: 1, removed: 0, modified: 2, extra: { lines: '＋6 －3', renamed: 1 } },
  normalizationNotes: ['Renames detected by git at 50% similarity.'],
  data: {
    repo: '/tmp/repo',
    before: { ref: 'main', label: 'main' },
    after: { ref: 'WORKTREE', label: 'working tree' },
    totals: { added: 6, removed: 3 },
    partial: false,
    rows: [
      { path: 'src/added.ts', status: 'add', added: 4, removed: 0, binary: false },
      { path: 'src/edit.ts', status: 'mod', added: 2, removed: 3, binary: false },
      {
        path: 'ui/Modal.tsx',
        status: 'rename',
        oldPath: 'ui/OldModal.tsx',
        score: 100,
        added: 0,
        removed: 0,
        binary: false,
      },
      { path: 'logo.png', status: 'mod', added: 0, removed: 0, binary: true },
    ],
  },
};

const IMAGE_REPORT: ReportInput = {
  ...BASE,
  engineId: 'image',
  a: { name: 'before.png', kind: 'image' },
  b: { name: 'after.png', kind: 'image' },
  summary: { added: 0, removed: 0, modified: 2, extra: { difference: '8.00%', regions: 2 } },
  data: {
    pct: 8,
    diffPixels: 3200,
    totalPixels: 40_000,
    sameSize: false,
    dims: { before: [200, 200], after: [220, 200] },
    regions: [{ left: 10, top: 10, width: 20, height: 20, areaPct: 4 }],
  },
  images: { before: 'data:image/png;base64,AAA', mask: 'data:image/png;base64,BBB' },
};

describe('markdown report', () => {
  const output = renderMarkdown(BASE);

  it('opens with the two inputs, the engine and when it was made', () => {
    expect(output).toContain('# before.txt ↔ after.txt');
    expect(output).toContain('/tmp/before.txt');
    expect(output).toContain('| Engine | text |');
    expect(output).toContain('2026-08-12 10:30:00');
  });

  it('states the counts before showing any rows', () => {
    expect(output.indexOf('**3 changes**')).toBeLessThan(output.indexOf('```diff'));
    expect(output).toContain('1 added, 1 removed, 1 modified');
  });

  it('renders a fenced diff block a reviewer can paste anywhere', () => {
    expect(output).toContain('```diff');
    expect(output).toContain('-value one');
    expect(output).toContain('+value two');
    expect(output).toContain('@@ 12 unchanged lines @@');
  });

  it('strips the word-level markers, which are an internal encoding', () => {
    expect(output).not.toContain('⟦');
    expect(output).not.toContain('⟧');
  });

  it('lists every normalisation that was applied (Rule 3)', () => {
    expect(output).toContain('Normalised line endings');
  });

  it('says what it suppressed when normalisation hid something', () => {
    expect(renderMarkdown(JSON_REPORT)).toContain('1 suppressed by normalisation');
  });

  it('renders JSON as a path table, skipping unchanged rows and containers', () => {
    const json = renderMarkdown(JSON_REPORT);
    expect(json).toContain('| `$.name` | changed | `"one"` | `"two"` |');
    expect(json).toContain('type (number → string)');
    expect(json).not.toContain('$.kept');
    expect(json).not.toContain('| `$` |');
  });

  it('renders folders as a file table of what changed', () => {
    const folder = renderMarkdown(FOLDER_REPORT);
    expect(folder).toContain('| `src/edit.ts` | mod | 100 B | 220 B |');
    expect(folder).not.toContain('keep.ts');
  });

  it('renders a git comparison with its refs, line counts and rename notes', () => {
    const git = renderMarkdown(GIT_REPORT);
    expect(git).toContain('`main` → `working tree`');
    expect(git).toContain('**＋6 －3** lines');
    expect(git).toContain('| `src/edit.ts` | mod | 2 | 3 |');
    // A binary file has no line counts to report — saying "0" would be a lie.
    expect(git).toContain('| `logo.png` | mod | binary | binary |');
    expect(git).toContain('from `ui/OldModal.tsx` (100%)');
  });

  it('says two identical refs are identical rather than printing an empty table', () => {
    const git = renderMarkdown({ ...GIT_REPORT, data: { ...GIT_REPORT.data, rows: [] } });
    expect(git).toContain('identical');
    expect(git).not.toContain('| File |');
  });

  it('renders an image comparison as numbers, since Markdown cannot hold the pixels', () => {
    const image = renderMarkdown(IMAGE_REPORT);
    expect(image).toContain('**8.00%** of pixels differ');
    expect(image).toContain('size mismatch');
    expect(image).toContain('| 1 | 10%, 10% |');
  });

  it('escapes a pipe so one value cannot break the table', () => {
    const risky = renderMarkdown({
      ...JSON_REPORT,
      data: {
        rows: [{ depth: 1, key: 'x', path: '$.x', state: 'chg', a: 'a|b', b: 'c' }],
      },
    });
    expect(risky).toContain('a\\|b');
  });
});

describe('unified patch', () => {
  it('is a real patch header plus the diff body, with no fences', () => {
    const patch = renderUnifiedPatch(BASE);
    expect(patch.startsWith('--- /tmp/before.txt\n+++ /tmp/after.txt\n')).toBe(true);
    expect(patch).not.toContain('```');
    expect(patch).toContain('+fresh');
  });
});

describe('html report', () => {
  const output = renderHtml(BASE);

  it('is a complete standalone document', () => {
    expect(output.startsWith('<!doctype html>')).toBe(true);
    expect(output).toContain('</html>');
    expect(output).toContain('<style>');
  });

  it('makes no external requests — the promise the app itself makes', () => {
    expect(output).not.toMatch(/<script/i);
    expect(output).not.toMatch(/https?:\/\//);
    expect(output).not.toMatch(/<link[^>]+href/i);
  });

  it('escapes content so a file full of angle brackets cannot inject markup', () => {
    const risky = renderHtml({
      ...BASE,
      data: { rows: [{ kind: 'add', right: 1, text: '<img onerror="alert(1)">' }] },
    });
    expect(risky).not.toContain('<img onerror');
    expect(risky).toContain('&lt;img onerror=&quot;alert(1)&quot;&gt;');
  });

  it('keeps word-level marks as spans rather than as literal brackets', () => {
    expect(output).toContain('<span class="w del">one</span>');
    expect(output).toContain('<span class="w add">two</span>');
    expect(output).not.toContain('⟦');
  });

  it('pre-expands folds, since a static file cannot expand them later', () => {
    expect(output).toContain('12 unchanged lines');
  });

  it('embeds images as data URLs so the file travels alone', () => {
    const image = renderHtml(IMAGE_REPORT);
    expect(image).toContain('src="data:image/png;base64,AAA"');
    expect(image).toContain('Difference');
    expect(image).toContain('8.00%');
  });

  it('collapses each section with a native <details>, still open by default', () => {
    const output = renderHtml(BASE);
    expect(output).toContain('<details class="section" open>');
    expect(output).toContain('<summary>Changes');
    // The whole reason it is <details> and not a script: the file has to stay
    // script-free, and it has to print. Print forces the content back on.
    expect(output).not.toMatch(/<script/i);
    expect(output).toContain('details.section > div { display: block !important; }');
  });

  it('offers a deep link only when both sides are on disk', () => {
    const onDisk = renderHtml({
      ...BASE,
      a: { ...BASE.a, path: '/work/a.ts' },
      b: { ...BASE.b, path: '/work/b.ts' },
    });
    expect(onDisk).toContain('Open in TwinScope');
    // Escaped as HTML, so the `&` between parameters is an entity in the attribute.
    expect(onDisk).toContain(
      'twinscope://compare?a=%2Fwork%2Fa.ts&amp;b=%2Fwork%2Fb.ts&amp;engine=text',
    );

    // Nothing for a link to point at without paths — a pasted pair, say — and a
    // dead link in a report someone else opens is worse than none.
    const pasted = renderHtml({
      ...BASE,
      a: { name: 'clipboard', kind: 'text' },
      b: { name: 'clipboard', kind: 'text' },
    });
    expect(pasted).not.toContain('twinscope://compare');
    expect(pasted).not.toContain('Open in TwinScope');
  });

  it('wipes between two images with a resize handle, not with a script', () => {
    const both = renderHtml({
      ...IMAGE_REPORT,
      images: { before: 'data:image/png;base64,AAA', after: 'data:image/png;base64,CCC' },
    });
    expect(both).toContain('class="slider"');
    expect(both).toContain('resize: horizontal');

    // With only one side there is nothing behind the handle, so there is no slider.
    expect(renderHtml(IMAGE_REPORT)).not.toContain('class="slider"');
  });

  it('renders json, folder and git bodies as tables', () => {
    expect(renderHtml(JSON_REPORT)).toContain('<td>$.name</td>');
    expect(renderHtml(FOLDER_REPORT)).toContain('<td>src/edit.ts</td>');

    const git = renderHtml(GIT_REPORT);
    expect(git).toContain('<td>src/edit.ts</td>');
    expect(git).toContain('main → working tree');
    expect(git).toContain('<td colspan="2">binary</td>');
    expect(git).toContain('from ui/OldModal.tsx (100%)');
  });
});
