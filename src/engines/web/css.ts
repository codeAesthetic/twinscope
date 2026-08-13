/**
 * Comparing stylesheets by rule rather than by text (v0.3.2).
 *
 * A text diff of two stylesheets reports that a line changed. What a reader wants is
 * *which declaration* of *which selector* moved — so this parses far enough to answer
 * that and no further: selectors, declarations, and the at-rule a rule sits inside.
 *
 * It is not a CSS engine and does not pretend to be: no specificity, no cascade, no
 * computed values. Those need a browser, which is gated (plan §6.3.0).
 */

export interface CssRule {
  /** `@media (min-width: 700px) › .card h2` — the at-rule context, then the selector. */
  key: string;
  declarations: Map<string, string>;
}

/** A rule count past which a stylesheet is minified machinery, not something to read. */
const MAX_RULES = 5000;

function collapse(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/** Sorts a selector list so `a, b` and `b, a` are one rule. */
function normaliseSelector(selector: string): string {
  return collapse(selector)
    .split(',')
    .map((part) => collapse(part))
    .filter(Boolean)
    .sort()
    .join(', ');
}

function parseDeclarations(body: string): Map<string, string> {
  const declarations = new Map<string, string>();
  for (const chunk of body.split(';')) {
    const colon = chunk.indexOf(':');
    if (colon <= 0) continue;
    const property = collapse(chunk.slice(0, colon)).toLowerCase();
    const value = collapse(chunk.slice(colon + 1));
    if (property === '' || value === '') continue;
    declarations.set(property, value);
  }
  return declarations;
}

/**
 * Parses a stylesheet into rules.
 *
 * A hand-written brace walker rather than a regex: a regex cannot nest, and `@media`
 * blocks nest by definition. Comments are stripped first, since a comment containing a
 * brace would otherwise break the walk.
 */
export function parseCss(source: string): CssRule[] {
  const text = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules: CssRule[] = [];
  const context: string[] = [];

  let buffer = '';
  for (let at = 0; at < text.length && rules.length < MAX_RULES; at += 1) {
    const character = text[at] as string;

    if (character === '{') {
      const head = collapse(buffer);
      buffer = '';
      if (head.startsWith('@')) {
        // An at-rule with a block: `@media`, `@supports`, `@layer`. Its children are
        // the rules; the at-rule itself becomes part of their key.
        context.push(head);
      } else {
        // A plain rule. Consume to its closing brace, which cannot nest.
        const close = text.indexOf('}', at);
        const body = text.slice(at + 1, close === -1 ? undefined : close);
        const prefix = context.length === 0 ? '' : `${context.join(' › ')} › `;
        rules.push({
          key: `${prefix}${normaliseSelector(head)}`,
          declarations: parseDeclarations(body),
        });
        at = close === -1 ? text.length : close;
      }
      continue;
    }

    if (character === '}') {
      context.pop();
      buffer = '';
      continue;
    }

    buffer += character;
  }

  return rules;
}

export interface CssChange {
  key: string;
  state: 'added' | 'removed' | 'changed';
  /** For a changed rule: the declarations that differ. */
  declarations: Array<{ property: string; before: string | undefined; after: string | undefined }>;
}

/**
 * Compares two stylesheets rule by rule.
 *
 * A selector appearing twice in one sheet (which is legal and common) has its
 * declarations merged in source order, because that is what the browser does with
 * them — comparing the two occurrences separately would report a difference that has
 * no effect on the page.
 */
export function diffCss(before: string, after: string): CssChange[] {
  const index = (rules: CssRule[]): Map<string, Map<string, string>> => {
    const map = new Map<string, Map<string, string>>();
    for (const rule of rules) {
      const existing = map.get(rule.key);
      if (existing === undefined) map.set(rule.key, new Map(rule.declarations));
      else for (const [property, value] of rule.declarations) existing.set(property, value);
    }
    return map;
  };

  const left = index(parseCss(before));
  const right = index(parseCss(after));
  const changes: CssChange[] = [];

  for (const [key, declarations] of left) {
    const other = right.get(key);
    if (other === undefined) {
      changes.push({ key, state: 'removed', declarations: [] });
      continue;
    }

    const differing: CssChange['declarations'] = [];
    for (const [property, value] of declarations) {
      const otherValue = other.get(property);
      if (otherValue !== value) {
        differing.push({ property, before: value, after: otherValue });
      }
    }
    for (const [property, value] of other) {
      if (!declarations.has(property)) {
        differing.push({ property, before: undefined, after: value });
      }
    }
    if (differing.length > 0) changes.push({ key, state: 'changed', declarations: differing });
  }

  for (const key of right.keys()) {
    if (!left.has(key)) changes.push({ key, state: 'added', declarations: [] });
  }

  return changes;
}
