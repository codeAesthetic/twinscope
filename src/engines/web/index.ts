import { diffCss, type CssChange } from './css';
import { readPage, type Asset, type DomNode, type PageFacts } from './dom';
import { radarFrom, ratioScore } from '../radar';
import type { DiffEngine, DiffResult, InputRef } from '../types';

/**
 * Website comparison — the half that needs no network (v0.3.2, MD §16 / A7).
 *
 * The feature as planned is URL↔URL with a headless screenshot. That half is **gated**
 * (plan §6.3.0): it needs a runtime network call *and* a bundled browser, neither of
 * which is a decision this engine can make. What needs neither is the comparison
 * itself, so two saved pages are compared properly and every result says what was not
 * done.
 *
 * Four sections, because a page differs in four unrelated ways and one row list of
 * them all is what makes an HTML diff useless:
 *
 *  - **Structure** — nodes keyed structurally, attributes and text per node;
 *  - **Style** — inline `<style>` rules, per selector and per declaration;
 *  - **Assets** — what the page pulls in, listed and never fetched;
 *  - **Accessibility** — the heading outline, missing `alt`, unlabelled controls,
 *    `lang`. The honest subset: the real a11y tree needs a browser.
 */

export type WebSection = 'structure' | 'style' | 'assets' | 'a11y';

export interface WebRow {
  section: WebSection;
  /** The node key, selector, URL or fact this row is about. */
  key: string;
  state: 'added' | 'removed' | 'changed';
  /** What changed, in a form the view renders verbatim. */
  detail: string;
  before: string | undefined;
  after: string | undefined;
  /** True for an a11y row that is a problem rather than a difference. */
  concern?: boolean;
}

export interface WebDiffData {
  rows: WebRow[];
  counts: Record<WebSection, number>;
  pages: {
    before: { title: string; nodes: number; assets: number; textLength: number; lang: string };
    after: { title: string; nodes: number; assets: number; textLength: number; lang: string };
  };
}

export interface WebDiffOptions {
  /** Compare `class` attributes. Off for a pair from two different build hashes. */
  compareClasses: boolean;
  /** Ignore a query string on an asset URL — the usual cache-buster. */
  ignoreAssetQuery: boolean;
  /** Attributes never compared: `data-reactid`, framework noise. */
  ignoreAttributes: string[];
}

export const DEFAULT_WEB_OPTIONS: WebDiffOptions = {
  compareClasses: true,
  ignoreAssetQuery: false,
  ignoreAttributes: ['data-reactid', 'data-react-checksum', 'nonce'],
};

/** Rows past which the result stops being navigable; reported, never silent. */
const MAX_ROWS = 20_000;

function assetKey(asset: Asset, ignoreQuery: boolean): string {
  const url = ignoreQuery ? (asset.url.split('?')[0] ?? asset.url) : asset.url;
  return `${asset.tag} ${url}`;
}

/**
 * Pairs asset URLs so a cache-busted filename reads as one change.
 *
 * `app.a1b2c3.js` → `app.d4e5f6.js` is the commonest real difference between two
 * builds, and reporting it as a removal plus an addition means every asset row in
 * every comparison is noise. Pairing is on the tag plus the *shape* of the name with
 * hash-looking runs removed.
 */
function fingerprintUrl(url: string): string {
  return url
    .split('?')[0]!
    .replace(/[a-f0-9]{8,}/gi, '#')
    .replace(/\d{6,}/g, '#');
}

function diffAssets(
  before: readonly Asset[],
  after: readonly Asset[],
  options: WebDiffOptions,
): WebRow[] {
  const rows: WebRow[] = [];
  const key = (asset: Asset): string => assetKey(asset, options.ignoreAssetQuery);

  const left = new Map(before.map((asset) => [key(asset), asset]));
  const right = new Map(after.map((asset) => [key(asset), asset]));

  const unmatchedLeft = [...left.entries()].filter(([id]) => !right.has(id));
  const unmatchedRight = [...right.entries()].filter(([id]) => !left.has(id));

  const takenRight = new Set<string>();
  for (const [id, asset] of unmatchedLeft) {
    const shape = `${asset.tag} ${fingerprintUrl(asset.url)}`;
    const match = unmatchedRight.find(
      ([otherId, other]) =>
        !takenRight.has(otherId) && `${other.tag} ${fingerprintUrl(other.url)}` === shape,
    );

    if (match === undefined) {
      rows.push({
        section: 'assets',
        key: id,
        state: 'removed',
        detail: `${asset.tag} no longer loaded`,
        before: asset.url,
        after: undefined,
      });
      continue;
    }

    takenRight.add(match[0]);
    rows.push({
      section: 'assets',
      key: `${asset.tag} ${fingerprintUrl(asset.url)}`,
      state: 'changed',
      detail: 'same asset, different URL',
      before: asset.url,
      after: match[1].url,
    });
  }

  for (const [id, asset] of unmatchedRight) {
    if (takenRight.has(id)) continue;
    rows.push({
      section: 'assets',
      key: id,
      state: 'added',
      detail: `${asset.tag} now loaded`,
      before: undefined,
      after: asset.url,
    });
  }

  return rows;
}

function diffNodes(
  before: readonly DomNode[],
  after: readonly DomNode[],
  options: WebDiffOptions,
): WebRow[] {
  const ignored = new Set(options.ignoreAttributes.map((name) => name.toLowerCase()));
  // `ignoreAssetQuery` has to apply here too, not only in the assets section: a query
  // string ignored in one place and reported in the other is a contradictory answer to
  // the same question.
  const URL_ATTRIBUTES = new Set(['src', 'href', 'srcset', 'data', 'poster', 'action']);
  const describe = (node: DomNode): string => {
    const parts = Object.entries(node.attributes)
      .filter(([name]) => !ignored.has(name) && (options.compareClasses || name !== 'class'))
      .sort(([one], [other]) => one.localeCompare(other))
      .map(([name, value]) => {
        const shown =
          options.ignoreAssetQuery && URL_ATTRIBUTES.has(name)
            ? (value.split('?')[0] ?? value)
            : value;
        return `${name}="${shown}"`;
      });
    return `<${node.tag}${parts.length === 0 ? '' : ` ${parts.join(' ')}`}>${node.text}`;
  };

  const left = new Map(before.map((node) => [node.key, node]));
  const right = new Map(after.map((node) => [node.key, node]));
  const rows: WebRow[] = [];

  for (const [key, node] of left) {
    const other = right.get(key);
    if (other === undefined) {
      rows.push({
        section: 'structure',
        key,
        state: 'removed',
        detail: `<${node.tag}> gone`,
        before: describe(node),
        after: undefined,
      });
      continue;
    }
    const one = describe(node);
    const two = describe(other);
    if (one === two) continue;

    rows.push({
      section: 'structure',
      key,
      state: 'changed',
      detail:
        node.tag !== other.tag
          ? `<${node.tag}> became <${other.tag}>`
          : node.text !== other.text
            ? 'text changed'
            : 'attributes changed',
      before: one,
      after: two,
    });
  }

  for (const [key, node] of right) {
    if (left.has(key)) continue;
    rows.push({
      section: 'structure',
      key,
      state: 'added',
      detail: `<${node.tag}> added`,
      before: undefined,
      after: describe(node),
    });
  }

  return pairRetaggedNodes(rows, before, after, describe);
}

/**
 * Folds a removal and an addition in the same *slot* into one "became" row.
 *
 * A node's key contains its tag, so an `<h1>` that became an `<h3>` cannot pair on the
 * key — it arrives as two rows for one edit, which is exactly the noise this engine
 * exists to remove. `position` is the tag-free slot, so the two can be recognised.
 */
function pairRetaggedNodes(
  rows: readonly WebRow[],
  before: readonly DomNode[],
  after: readonly DomNode[],
  describe: (node: DomNode) => string,
): WebRow[] {
  const removedByPosition = new Map(before.map((node) => [node.position, node] as const));
  const addedByPosition = new Map(after.map((node) => [node.position, node] as const));

  const out: WebRow[] = [];
  const consumed = new Set<string>();

  for (const row of rows) {
    if (row.state !== 'removed' || row.section !== 'structure') {
      if (!(row.state === 'added' && consumed.has(row.key))) out.push(row);
      continue;
    }

    const node = before.find((candidate) => candidate.key === row.key);
    const other = node === undefined ? undefined : addedByPosition.get(node.position);
    const stillThere = other !== undefined && removedByPosition.get(node?.position ?? '') !== other;

    if (node === undefined || other === undefined || !stillThere || other.tag === node.tag) {
      out.push(row);
      continue;
    }

    consumed.add(other.key);
    out.push({
      section: 'structure',
      key: node.key,
      state: 'changed',
      detail: `<${node.tag}> became <${other.tag}>`,
      before: describe(node),
      after: describe(other),
    });
  }

  return out.filter((row) => !(row.state === 'added' && consumed.has(row.key)));
}

function cssRows(changes: readonly CssChange[]): WebRow[] {
  return changes.map((change) => ({
    section: 'style' as const,
    key: change.key,
    state: change.state,
    detail:
      change.state === 'changed'
        ? change.declarations
            .map(
              (declaration) =>
                `${declaration.property}: ${declaration.before ?? '—'} → ${declaration.after ?? '—'}`,
            )
            .join('; ')
        : change.state === 'added'
          ? 'new rule'
          : 'rule gone',
    before: change.declarations
      .map((declaration) => `${declaration.property}: ${declaration.before ?? '—'}`)
      .join('; '),
    after: change.declarations
      .map((declaration) => `${declaration.property}: ${declaration.after ?? '—'}`)
      .join('; '),
  }));
}

/**
 * The accessibility section: differences *and* standing problems.
 *
 * Both, deliberately. "This page has three images with no alt text" is worth saying
 * even when the other page has three too — a comparison is where someone is already
 * looking at the markup, and a section that only reported *changes* in a11y would stay
 * silent on a page that was inaccessible in both versions.
 */
function a11yRows(before: PageFacts, after: PageFacts): WebRow[] {
  const rows: WebRow[] = [];

  const outlineBefore = before.headings.map((heading) => heading.split(':')[0]).join(' ');
  const outlineAfter = after.headings.map((heading) => heading.split(':')[0]).join(' ');
  if (outlineBefore !== outlineAfter) {
    rows.push({
      section: 'a11y',
      key: 'heading outline',
      state: 'changed',
      detail: 'the heading structure changed, which is what a screen reader navigates by',
      before: outlineBefore === '' ? '(no headings)' : outlineBefore,
      after: outlineAfter === '' ? '(no headings)' : outlineAfter,
      concern: true,
    });
  }

  if (before.lang !== after.lang) {
    rows.push({
      section: 'a11y',
      key: 'lang',
      state: 'changed',
      detail: 'the document language changed',
      before: before.lang === '' ? '(not set)' : before.lang,
      after: after.lang === '' ? '(not set)' : after.lang,
      concern: after.lang === '',
    });
  }

  const alt = { before: before.imagesWithoutAlt.length, after: after.imagesWithoutAlt.length };
  if (alt.before !== alt.after || alt.after > 0) {
    rows.push({
      section: 'a11y',
      key: 'images without alt',
      state: alt.after > alt.before ? 'added' : alt.after < alt.before ? 'removed' : 'changed',
      detail:
        alt.after === alt.before
          ? `${alt.after} image${alt.after === 1 ? '' : 's'} have no alt attribute in both versions`
          : 'the number of images with no alt attribute changed',
      before: String(alt.before),
      after: String(alt.after),
      concern: alt.after > 0,
    });
  }

  const labels = {
    before: before.controlsWithoutLabel.length,
    after: after.controlsWithoutLabel.length,
  };
  if (labels.before !== labels.after || labels.after > 0) {
    rows.push({
      section: 'a11y',
      key: 'unlabelled controls',
      state:
        labels.after > labels.before
          ? 'added'
          : labels.after < labels.before
            ? 'removed'
            : 'changed',
      detail:
        labels.after === labels.before
          ? `${labels.after} form control${labels.after === 1 ? '' : 's'} have no label in both versions`
          : 'the number of form controls with no label changed',
      before: String(labels.before),
      after: String(labels.after),
      concern: labels.after > 0,
    });
  }

  if (before.title !== after.title) {
    rows.push({
      section: 'a11y',
      key: 'title',
      state: 'changed',
      detail: 'the page title changed',
      before: before.title,
      after: after.title,
    });
  }

  return rows;
}

function textOf(input: InputRef): string {
  if (input.text !== undefined) return input.text;
  throw new Error(`${input.name} has no readable content.`);
}

export const webEngine: DiffEngine<WebDiffOptions, WebDiffData> = {
  meta: { id: 'web', label: 'Page diff', priority: 45 },

  canHandle: (a, b) => a.kind === 'html' && b.kind === 'html',

  defaultOptions: () => ({
    ...DEFAULT_WEB_OPTIONS,
    ignoreAttributes: [...DEFAULT_WEB_OPTIONS.ignoreAttributes],
  }),

  async compare(a, b, options, ctx): Promise<DiffResult<WebDiffData>> {
    const startedAt = Date.now();

    ctx.progress(15, 'reading pages');
    // Classes leave the *key* as well as the comparison when they are not being
    // compared: with them in the key, `div.a` and `div.b` in the same position never
    // pair, so "ignore classes" would report the subtree as removed-and-added.
    const read = { classesInKey: options.compareClasses };
    const before = readPage(textOf(a), read);
    const after = readPage(textOf(b), read);

    if (ctx.signal.aborted) throw new DOMException('Comparison cancelled', 'AbortError');

    ctx.progress(45, 'comparing structure');
    const structure = diffNodes(before.nodes, after.nodes, options);

    ctx.progress(65, 'comparing styles');
    const style = cssRows(diffCss(before.css, after.css));

    ctx.progress(80, 'comparing assets');
    const assets = diffAssets(before.assets, after.assets, options);
    const a11y = a11yRows(before, after);

    const all = [...structure, ...style, ...assets, ...a11y];
    const truncated = all.length > MAX_ROWS;
    const rows = truncated ? all.slice(0, MAX_ROWS) : all;

    const counts: Record<WebSection, number> = {
      structure: structure.length,
      style: style.length,
      assets: assets.length,
      a11y: a11y.length,
    };

    const notes: string[] = [
      // Said in the result, not only in the plan: a reader has to know that "no visual
      // differences" is not something this comparison looked for.
      'This is a comparison of two saved pages: their markup, their inline styles, the assets they reference, and what a screen reader would find. No page was fetched, nothing was rendered, and no screenshot was taken.',
      'Linked stylesheets are listed as assets rather than compared — the file itself was not given to this comparison, and fetching it is a separate decision.',
      'Computed styles need a browser, so a rule that changed here may or may not change what the page looks like.',
    ];
    if (!options.compareClasses) notes.push('Class attributes were not compared.');
    if (options.ignoreAssetQuery) notes.push('Query strings on asset URLs were ignored.');
    if (options.ignoreAttributes.length > 0) {
      notes.push(`Attributes ignored: ${options.ignoreAttributes.join(', ')}.`);
    }
    if (truncated) {
      notes.push(
        `The result was capped at ${MAX_ROWS.toLocaleString()} rows; ${(all.length - MAX_ROWS).toLocaleString()} more differences are counted but not listed.`,
      );
    }

    ctx.progress(100, 'done');

    const added = rows.filter((row) => row.state === 'added').length;
    const removed = rows.filter((row) => row.state === 'removed').length;
    const changed = rows.filter((row) => row.state === 'changed').length;

    return {
      engineId: 'web',
      summary: {
        added,
        removed,
        modified: changed,
        extra: {
          structure: counts.structure,
          style: counts.style,
          assets: counts.assets,
          a11y: counts.a11y,
        },
        radar: radarFrom({
          structure: ratioScore(
            structure.filter((row) => row.state !== 'changed').length,
            Math.max(1, before.nodes.length),
          ),
          content: ratioScore(
            structure.filter((row) => row.detail === 'text changed').length,
            Math.max(1, before.nodes.length),
          ),
          // Style is metadata about the page rather than its content — and `visual`
          // stays **absent**, because nothing here rendered a pixel.
          metadata: ratioScore(counts.style + counts.a11y, Math.max(1, before.nodes.length)),
          performance: ratioScore(
            Math.abs(after.assets.length - before.assets.length),
            Math.max(1, before.assets.length),
          ),
        }),
      },
      data: {
        rows,
        counts,
        pages: {
          before: {
            title: before.title,
            nodes: before.nodes.length,
            assets: before.assets.length,
            textLength: before.textLength,
            lang: before.lang,
          },
          after: {
            title: after.title,
            nodes: after.nodes.length,
            assets: after.assets.length,
            textLength: after.textLength,
            lang: after.lang,
          },
        },
      },
      normalizationNotes: notes,
      timings: { ms: Date.now() - startedAt },
    };
  },
};

export { parseCss, diffCss } from './css';
export { readPage } from './dom';
