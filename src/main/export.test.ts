import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { render } from './export';
import { REPORT_TOKENS } from '../shared/report/html';
import type { ReportInput } from '../shared/report/types';

/**
 * Lives in `src/main` rather than beside the renderers because it reads files:
 * `src/shared` is compiled for the web target too, which has no node types.
 */

const INPUT: ReportInput = {
  a: { name: 'a.txt', path: '/tmp/a.txt', kind: 'text' },
  b: { name: 'b.txt', path: '/tmp/b.txt', kind: 'text' },
  engineId: 'text',
  summary: { added: 1, removed: 0, modified: 0 },
  options: {},
  normalizationNotes: [],
  generatedAt: '2026-08-12T10:00:00.000Z',
  data: { rows: [{ kind: 'add', right: 1, text: 'hello' }] },
};

describe('render', () => {
  it('picks a renderer per format', () => {
    expect(render('html', INPUT).startsWith('<!doctype html>')).toBe(true);
    expect(render('md', INPUT)).toContain('```diff');
    expect(render('patch', INPUT).startsWith('--- /tmp/a.txt')).toBe(true);
  });
});

describe('report tokens', () => {
  /**
   * The report cannot import the app\'s stylesheet, so its palette is a copy.
   * This is what stops the copy from drifting: change tokens.css and this fails
   * until the report is updated to match.
   */
  it('match the dark palette in tokens.css exactly', () => {
    const css = readFileSync(join(__dirname, '../renderer/src/styles/tokens.css'), 'utf8');
    const dark = css.slice(css.indexOf(':root {'), css.indexOf('html[data-theme='));

    for (const [name, value] of Object.entries(REPORT_TOKENS)) {
      const match = new RegExp(`${name}:\\s*([^;]+);`).exec(dark);
      expect(match, `${name} is missing from tokens.css`).not.toBeNull();
      expect(match?.[1]?.trim(), `${name} drifted from tokens.css`).toBe(value);
    }
  });
});
