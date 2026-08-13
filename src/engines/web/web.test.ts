import { describe, expect, it, vi } from 'vitest';
import { webEngine, type WebDiffData } from './index';
import { diffCss, parseCss } from './css';
import { readPage } from './dom';
import { detectKind } from '../detect';
import type { EngineCtx, InputRef } from '../types';

function ctx(): EngineCtx {
  return { signal: new AbortController().signal, progress: vi.fn() };
}

function ref(side: 'A' | 'B', text: string): InputRef {
  return { side, kind: 'html', name: `${side}.html`, text, size: text.length };
}

async function run(before: string, after: string, options = {}) {
  const result = await webEngine.compare(
    ref('A', before),
    ref('B', after),
    { ...webEngine.defaultOptions(), ...options },
    ctx(),
  );
  return { result, data: result.data as WebDiffData };
}

const PAGE = (body: string, head = ''): string =>
  `<!doctype html><html lang="en"><head><title>Home</title>${head}</head><body>${body}</body></html>`;

describe('reading a page', () => {
  it('survives the markup real pages actually have', () => {
    // Unclosed `<li>`, a minimised attribute, and a stray `<br>`: an XML-strict parser
    // refuses all three, which is why this engine does not use one.
    const facts = readPage('<html><body><ul><li>one<li>two</ul><p class=lead>a<br>b</body></html>');
    expect(facts.nodes.filter((node) => node.tag === 'li')).toHaveLength(2);
    expect(facts.nodes.find((node) => node.tag === 'p')?.attributes['class']).toBe('lead');
  });

  it('treats a class list as a set, and sorts inline styles', () => {
    const one = readPage(PAGE('<div class="a b c" style="color: red; margin: 0">x</div>'));
    const two = readPage(PAGE('<div class="c a b" style="margin: 0; color: red">x</div>'));
    expect(one.nodes.map((node) => node.attributes)).toEqual(
      two.nodes.map((node) => node.attributes),
    );
  });

  it('keys nodes structurally, so an insertion shifts only what follows', () => {
    const before = readPage(PAGE('<main><p>one</p><p>two</p></main>'));
    const after = readPage(PAGE('<main><p>zero</p><p>one</p><p>two</p></main>'));
    // `p:2` exists in both; the third only in the after page.
    expect(before.nodes.some((node) => node.key.endsWith('p:2'))).toBe(true);
    expect(after.nodes.some((node) => node.key.endsWith('p:3'))).toBe(true);
  });

  it('prefers an id, because that is what a page author means by "this element"', () => {
    const facts = readPage(PAGE('<div><section id="hero">x</section></div>'));
    expect(facts.nodes.some((node) => node.key.includes('#hero'))).toBe(true);
  });

  it('collects assets, headings, missing alts and unlabelled controls', () => {
    const facts = readPage(
      PAGE(
        [
          '<h1>Title</h1><h2>Section</h2>',
          '<img src="/a.png" alt="a"><img src="/b.png">',
          '<label for="name">Name</label><input id="name">',
          '<label>Wrapped <input id="wrapped"></label>',
          '<input id="loose">',
          '<input type="hidden" id="csrf">',
          '<script src="/app.js"></script>',
        ].join(''),
        '<link rel="stylesheet" href="/site.css">',
      ),
    );

    expect(facts.headings).toEqual(['h1:Title', 'h2:Section']);
    expect(facts.imagesWithoutAlt).toEqual(['/b.png']);
    // `name` has a `for=`, `wrapped` is inside its label, `csrf` is hidden.
    expect(facts.controlsWithoutLabel).toEqual(['loose']);
    expect(facts.assets.map((asset) => asset.url).sort()).toEqual([
      '/a.png',
      '/app.js',
      '/b.png',
      '/site.css',
    ]);
    expect(facts.lang).toBe('en');
    expect(facts.title).toBe('Home');
  });

  it('never leaves its own bookkeeping attribute in the rows', () => {
    const facts = readPage(PAGE('<label>x <input id="a"></label>'));
    expect(JSON.stringify(facts.nodes)).not.toContain('twinscope');
  });
});

describe('css', () => {
  it('parses rules, at-rule context and declarations', () => {
    const rules = parseCss('.a{color:red}@media (min-width:700px){.a{color:blue}}');
    expect(rules[0]?.key).toBe('.a');
    expect(rules[1]?.key).toBe('@media (min-width:700px) › .a');
    expect(rules[1]?.declarations.get('color')).toBe('blue');
  });

  it('treats a selector list as a set and strips comments', () => {
    const one = parseCss('/* c */ h1, h2 { margin: 0 }');
    const two = parseCss('h2,h1{margin:0}');
    expect(one[0]?.key).toBe(two[0]?.key);
  });

  it('reports the declaration that changed, not that the rule changed', () => {
    const changes = diffCss('.card{color:red;padding:4px}', '.card{color:blue;padding:4px}');
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ key: '.card', state: 'changed' });
    expect(changes[0]?.declarations).toEqual([{ property: 'color', before: 'red', after: 'blue' }]);
  });

  it('merges a selector declared twice, as a browser would', () => {
    const changes = diffCss('.a{color:red}.a{color:red}', '.a{color:red}');
    expect(changes).toEqual([]);
  });
});

describe('webEngine', () => {
  it('routes two .html files to this engine rather than to a line diff', () => {
    expect(detectKind({ name: 'index.html', kind: 'unknown' })).toBe('html');
    expect(webEngine.canHandle(ref('A', ''), ref('B', ''))).toBe(true);
  });

  it('separates the four sections and opens with counts for each', async () => {
    const { data, result } = await run(
      PAGE('<main><h1>One</h1><img src="/a.png"></main>', '<style>.a{color:red}</style>'),
      PAGE(
        '<main><h2>One</h2><img src="/a.png" alt="a"><p>new</p></main>',
        '<style>.a{color:blue}</style>',
      ),
    );

    expect(data.counts.structure).toBeGreaterThan(0);
    expect(data.counts.style).toBe(1);
    expect(data.counts.a11y).toBeGreaterThan(0);
    expect(result.summary.extra?.['style']).toBe(1);
  });

  it('pairs a cache-busted asset as one change rather than two', async () => {
    const { data } = await run(
      PAGE('<script src="/static/app.a1b2c3d4.js"></script>'),
      PAGE('<script src="/static/app.99887766.js"></script>'),
    );
    const assets = data.rows.filter((row) => row.section === 'assets');
    expect(assets).toHaveLength(1);
    expect(assets[0]).toMatchObject({ state: 'changed', detail: 'same asset, different URL' });
  });

  it('reports a broken heading outline as a concern', async () => {
    const { data } = await run(PAGE('<h1>a</h1><h2>b</h2>'), PAGE('<h2>a</h2><h2>b</h2>'));
    const outline = data.rows.find((row) => row.key === 'heading outline');
    expect(outline).toMatchObject({ concern: true, before: 'h1 h2', after: 'h2 h2' });
  });

  it('says an a11y problem that is in *both* pages, not only a change', async () => {
    const page = PAGE('<img src="/a.png">');
    const { data } = await run(page, page);
    const alt = data.rows.find((row) => row.key === 'images without alt');
    expect(alt?.concern).toBe(true);
    expect(alt?.detail).toMatch(/in both versions/);
  });

  it('can be told to ignore classes and asset queries', async () => {
    const withClasses = await run(
      PAGE('<div class="a">x</div><img src="/a.png?v=1">'),
      PAGE('<div class="b">x</div><img src="/a.png?v=2">'),
    );
    expect(withClasses.data.counts.structure).toBeGreaterThan(0);

    const without = await run(
      PAGE('<div class="a">x</div><img src="/a.png?v=1">'),
      PAGE('<div class="b">x</div><img src="/a.png?v=2">'),
      { compareClasses: false, ignoreAssetQuery: true },
    );
    // The class change is ignored, and the asset URLs are equal without their query.
    expect(without.data.rows.filter((row) => row.section === 'structure')).toEqual([]);
    expect(without.data.counts.assets).toBe(0);
  });

  it('folds a retagged node into one row rather than two', async () => {
    // `<h1>` → `<h3>` in the same slot is one edit. The key contains the tag, so
    // without the position pass this arrives as a removal plus an addition.
    const { data } = await run(
      PAGE('<header><h1>Acme</h1></header>'),
      PAGE('<header><h3>Acme</h3></header>'),
    );
    const structure = data.rows.filter((row) => row.section === 'structure');
    expect(structure).toHaveLength(1);
    expect(structure[0]).toMatchObject({ state: 'changed', detail: '<h1> became <h3>' });
  });

  it('leaves the visual axis absent, because nothing was rendered', async () => {
    const { result } = await run(PAGE('<p>a</p>'), PAGE('<p>b</p>'));
    expect(result.summary.radar?.['visual']).toBeUndefined();
    expect(result.normalizationNotes.join(' ')).toMatch(/no screenshot was taken/i);
  });
});
