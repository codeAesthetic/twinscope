import { parse, type HTMLElement } from 'node-html-parser';

/**
 * Reading a saved page (v0.3.2).
 *
 * `node-html-parser` rather than `fast-xml-parser`: real pages have unclosed `<li>`s,
 * minimised attributes and stray text, and an XML-strict parser refuses most of the
 * web. This module turns a document into four flat views of it — nodes, styles,
 * assets and accessibility facts — because those are four different questions and
 * rolling them into one row list is what makes an HTML diff unreadable.
 */

export interface DomNode {
  /** A structural key: `body>main>div.card:2`. */
  key: string;
  /**
   * Parent path plus this node's position among *all* element siblings — the same
   * slot regardless of tag.
   *
   * Separate from `key`, which contains the tag: without it an `<h1>` that became an
   * `<h3>` cannot pair at all and reads as a removal plus an addition, which is two
   * rows for one edit.
   */
  position: string;
  tag: string;
  /** Attributes, with `class` normalised to a sorted set. */
  attributes: Record<string, string>;
  /** The node's own text, not its descendants'. */
  text: string;
}

export interface Asset {
  /** `img`, `script`, `link`, … */
  tag: string;
  url: string;
  /** `src`, `href`, `srcset`. */
  attribute: string;
}

export interface PageFacts {
  nodes: DomNode[];
  /** Every `<style>` block, concatenated in document order. */
  css: string;
  assets: Asset[];
  /** `h1`…`h6` in document order, as `h2:Section title`. */
  headings: string[];
  /** Images with no `alt` attribute at all (an empty `alt` is a decision). */
  imagesWithoutAlt: string[];
  /** Form controls with no label, by their best available identifier. */
  controlsWithoutLabel: string[];
  lang: string;
  title: string;
  /** Text of the whole document, whitespace-collapsed. */
  textLength: number;
}

/** Elements whose content is not markup and must not be walked as nodes. */
const OPAQUE = new Set(['script', 'style', 'template', 'noscript']);

const ASSET_ATTRIBUTES: Array<[string, string]> = [
  ['img', 'src'],
  ['img', 'srcset'],
  ['script', 'src'],
  ['link', 'href'],
  ['source', 'src'],
  ['source', 'srcset'],
  ['video', 'src'],
  ['audio', 'src'],
  ['iframe', 'src'],
  ['embed', 'src'],
  ['object', 'data'],
];

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Normalises attributes for comparison.
 *
 * `class` becomes a sorted, de-duplicated list: two builds that emit the same classes
 * in a different order are not a difference, and reporting one trains people to
 * ignore this section. `style` keeps its declarations but sorts them, for the same
 * reason.
 */
function normaliseAttributes(element: HTMLElement): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(element.attributes)) {
    if (name === 'class') {
      out[name] = [...new Set(value.split(/\s+/).filter(Boolean))].sort().join(' ');
      continue;
    }
    if (name === 'style') {
      out[name] = value
        .split(';')
        .map((declaration) => collapse(declaration))
        .filter(Boolean)
        .sort()
        .join('; ');
      continue;
    }
    out[name] = collapse(value);
  }
  return out;
}

/** The node's own text: children's text belongs to the children's rows. */
function ownText(element: HTMLElement): string {
  return collapse(
    element.childNodes
      .filter((node) => node.nodeType === 3)
      .map((node) => node.rawText)
      .join(' '),
  );
}

/**
 * A structural key.
 *
 * `tag.class:index` — the index counts same-tag siblings, so an inserted `<div>`
 * shifts only the nodes after it rather than reporting the whole subtree as changed.
 * An `id` wins over everything, because an id is what a page author means by "this
 * element" and it survives being moved.
 */
function keyFor(
  element: HTMLElement,
  parentKey: string,
  sameTagIndex: number,
  withClasses: boolean,
): string {
  const id = element.attributes['id'];
  if (id !== undefined && id !== '') return `${parentKey}>#${id}`;

  const classes = !withClasses
    ? ''
    : (element.attributes['class'] ?? '').split(/\s+/).filter(Boolean).sort().slice(0, 2).join('.');
  const tag = element.rawTagName ?? 'node';
  const self = `${tag}${classes === '' ? '' : `.${classes}`}${sameTagIndex > 1 ? `:${sameTagIndex}` : ''}`;
  return parentKey === '' ? self : `${parentKey}>${self}`;
}

/** A depth cap: a page nested past this is defending itself against being read. */
const MAX_DEPTH = 60;
const MAX_NODES = 20_000;

export interface ReadOptions {
  /**
   * Whether a node's classes are part of its key.
   *
   * Off when the caller is not comparing classes: with classes in the key, a `div.a`
   * and a `div.b` in the same position never pair at all, so "ignore classes" would
   * report the whole subtree as removed-and-added instead of ignoring anything.
   */
  classesInKey?: boolean;
}

export function readPage(html: string, options: ReadOptions = {}): PageFacts {
  const classesInKey = options.classesInKey !== false;
  const document = parse(html, {
    // The two we *do* want as text rather than as nodes: a stylesheet and a script
    // are compared as their own things, not as a DOM subtree.
    blockTextElements: { script: true, style: true, noscript: true, pre: true },
  });

  const facts: PageFacts = {
    nodes: [],
    css: '',
    assets: [],
    headings: [],
    imagesWithoutAlt: [],
    controlsWithoutLabel: [],
    lang: '',
    title: '',
    textLength: 0,
  };

  const styles: string[] = [];
  const labelledBy = new Set<string>();

  // A control is labelled by a `<label for=…>`, by being inside a `<label>`, or by
  // `aria-label`. All three have to be collected before any control is judged.
  for (const label of document.querySelectorAll('label')) {
    const target = label.attributes['for'];
    if (target !== undefined && target !== '') labelledBy.add(target);
    for (const nested of label.querySelectorAll('input, select, textarea')) {
      const id = nested.attributes['id'] ?? nested.attributes['name'] ?? '';
      if (id !== '') labelledBy.add(id);
      nested.setAttribute('data-twinscope-wrapped', '1');
    }
  }

  const walk = (element: HTMLElement, parentKey: string, position: string, depth: number): void => {
    if (depth > MAX_DEPTH || facts.nodes.length >= MAX_NODES) return;

    const tag = (element.rawTagName ?? '').toLowerCase();
    if (tag === '') return;

    const attributes = normaliseAttributes(element);
    const seen = new Map<string, number>();

    if (tag === 'html') facts.lang = attributes['lang'] ?? '';
    if (tag === 'title') facts.title = ownText(element);

    // Assets first: `<script src>` is the most interesting asset on most pages, and
    // it is also an opaque element — collecting them after the early return below
    // meant every script on every page went unlisted.
    for (const [assetTag, attribute] of ASSET_ATTRIBUTES) {
      if (assetTag !== tag) continue;
      const url = attributes[attribute];
      if (url !== undefined && url !== '') facts.assets.push({ tag, url, attribute });
    }

    if (OPAQUE.has(tag)) {
      if (tag === 'style') styles.push(element.rawText);
      // Still recorded as a node — a removed `<script>` is a change — but not walked.
      facts.nodes.push({ key: parentKey, position, tag, attributes, text: '' });
      return;
    }

    const key = parentKey;
    facts.nodes.push({ key, position, tag, attributes, text: ownText(element) });

    if (/^h[1-6]$/.test(tag)) {
      facts.headings.push(`${tag}:${collapse(element.text).slice(0, 80)}`);
    }
    if (tag === 'img' && attributes['alt'] === undefined) {
      facts.imagesWithoutAlt.push(attributes['src'] ?? '(no src)');
    }
    if (tag === 'input' || tag === 'select' || tag === 'textarea') {
      const id = attributes['id'] ?? attributes['name'] ?? '';
      const hidden = tag === 'input' && attributes['type'] === 'hidden';
      const labelled =
        labelledBy.has(id) ||
        attributes['aria-label'] !== undefined ||
        attributes['aria-labelledby'] !== undefined ||
        attributes['data-twinscope-wrapped'] === '1' ||
        (tag === 'input' && attributes['type'] === 'submit');
      if (!hidden && !labelled) facts.controlsWithoutLabel.push(id === '' ? `<${tag}>` : id);
    }

    let slot = 0;
    for (const child of element.childNodes) {
      if (child.nodeType !== 1) continue;
      const childElement = child as HTMLElement;
      const childTag = (childElement.rawTagName ?? '').toLowerCase();
      const index = (seen.get(childTag) ?? 0) + 1;
      seen.set(childTag, index);
      slot += 1;
      walk(
        childElement,
        keyFor(childElement, key, index, classesInKey),
        `${position}/${slot}`,
        depth + 1,
      );
    }
  };

  const root = document.querySelector('html') ?? document;
  walk(root as HTMLElement, keyFor(root as HTMLElement, '', 1, classesInKey), '1', 0);

  facts.css = styles.join('\n');
  facts.textLength = collapse(document.text).length;
  // The marker only existed to carry "this control is inside a label" through the
  // walk; leaving it in the rows would show up as an attribute the page does not have.
  for (const node of facts.nodes) delete node.attributes['data-twinscope-wrapped'];

  return facts;
}
