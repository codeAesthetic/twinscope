import { XMLParser, XMLValidator } from 'fast-xml-parser';

/**
 * XML → plain JavaScript values, for the JSON structural core (v0.2.4).
 *
 * Same shape of solution as the YAML engine, and for the same reason: once a
 * document is a tree of values there is nothing format-specific left to compare.
 * What is specific to XML is how it must be *read*, and every option below is a
 * decision about correctness rather than taste.
 */

export const ATTRIBUTE_PREFIX = '@';
export const TEXT_KEY = '#text';

export interface XmlParse {
  value: unknown;
  notes: string[];
}

export class XmlParseError extends Error {
  readonly line: number | undefined;
  readonly column: number | undefined;

  constructor(message: string, position?: { line: number; column: number }) {
    super(message);
    this.name = 'XmlParseError';
    this.line = position?.line;
    this.column = position?.column;
  }
}

/**
 * The parser, configured once.
 *
 *  - **`isArray: () => true` for elements.** Without it a single `<item>` parses to
 *    an object and two parse to an array, so adding the second child reports a
 *    *type change* — string-or-object became array — instead of one addition. That
 *    is the most common edit anyone makes to an XML document, and getting it wrong
 *    would make the engine useless for exactly the case it exists to serve.
 *  - **`parseTagValue: false`, `parseAttributeValue: false`.** XML has no types
 *    without a schema. The default coercion reads `<id>007</id>` as the number 7,
 *    which both loses information and equates `<v>1.0</v>` with `<v>1</v>`.
 *  - **Attributes as `@name`, text as `#text`.** They land beside each other in one
 *    object, so the existing tree shows an attribute change and a text change as
 *    separate rows rather than as one opaque "the element changed".
 *  - **`alwaysCreateTextNode: true`.** The same trap as `isArray`, one level down:
 *    by default `<id>7</id>` parses to the bare string `"7"` but `<id x="1">7</id>`
 *    parses to an object, so *adding an attribute to a leaf* would report a type
 *    change. With it, every element is an object and only its contents differ.
 *  - **`trimValues: true`.** Indentation is presentation in XML; `<a>\n  x\n</a>`
 *    and `<a>x</a>` are the same document to every consumer.
 */
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: ATTRIBUTE_PREFIX,
  textNodeName: TEXT_KEY,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  alwaysCreateTextNode: true,
  // Elements always; attributes never. `isAttribute` is the fourth argument.
  isArray: (_name, _path, _isLeaf, isAttribute) => !isAttribute,
});

/** Does the document use namespace prefixes? Worth saying, since they are compared. */
function usesNamespaces(text: string): boolean {
  return /<[^!?/][^>]*\s(?:xmlns(?::[\w.-]+)?)\s*=/.test(text) || /<[\w.-]+:[\w.-]+/.test(text);
}

function hasComments(text: string): boolean {
  return text.includes('<!--');
}

export function parseXml(text: string, label: string): XmlParse {
  const trimmed = text.trim();
  if (trimmed === '') {
    throw new XmlParseError(`${label} is empty, so there is no XML to compare`);
  }

  // Validated separately from parsing: `XMLParser` is forgiving and will happily
  // return something for a document with mismatched tags, while `XMLValidator`
  // reports the line and column — which is what makes the error worth reading.
  const verdict = XMLValidator.validate(trimmed, { allowBooleanAttributes: true });
  if (verdict !== true) {
    throw new XmlParseError(`${label} is not valid XML — ${verdict.err.msg}`, {
      line: verdict.err.line,
      column: verdict.err.col,
    });
  }

  const value = parser.parse(trimmed) as unknown;
  const notes: string[] = [
    // Rule 3: both of these change what the comparison reports, so both are said.
    'Every element is compared as a list, so adding a repeated child reads as an addition rather than a type change.',
    'Values are compared as text — XML carries no types, so `007` and `7` are different.',
  ];

  if (hasComments(text)) {
    notes.push(`Comments in ${label} are not compared.`);
  }
  if (usesNamespaces(text)) {
    notes.push(`Namespace prefixes in ${label} are compared as written, not resolved.`);
  }

  return { value, notes };
}

/** `<?xml …?>` arrives as a `?xml` key; a reader needs telling that is what it is. */
export function isDeclarationKey(key: string): boolean {
  return key.startsWith('?');
}
