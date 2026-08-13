import { apiShapeOf } from './api';
import { isDependencyFile } from './deps/manifest';
import type { InputKind, InputRef } from './types';

/**
 * Input type detection — ported from the approved mockup's `DD.detect` /
 * `DD.engineFor`.
 *
 * Rule 1 (MD Appendix D): never make the user pick an engine when we can work
 * it out. Order matters — extension first (cheap and usually right), then a
 * content sniff, then a JSON parse probe.
 */

const EXTENSION_KIND: Record<string, InputKind> = {
  json: 'json',
  har: 'json',
  geojson: 'json',
  yml: 'yaml',
  yaml: 'yaml',
  csv: 'csv',
  tsv: 'csv',
  md: 'md',
  markdown: 'md',
  txt: 'text',
  log: 'text',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  webp: 'image',
  avif: 'image',
  bmp: 'image',
  ts: 'code',
  tsx: 'code',
  js: 'code',
  jsx: 'code',
  mjs: 'code',
  cjs: 'code',
  css: 'code',
  scss: 'code',
  html: 'code',
  py: 'code',
  sql: 'code',
  rs: 'code',
  go: 'code',
  java: 'code',
  rb: 'code',
  sh: 'code',
  toml: 'code',
  // XML gets a structural engine of its own (v0.2.4); as `code` these were
  // line-diffed, which is the comparison a structural engine exists to avoid.
  xml: 'xml',
  xsd: 'xml',
  xsl: 'xml',
  xslt: 'xml',
  svg: 'xml',
  rss: 'xml',
  atom: 'xml',
  plist: 'xml',
};

/** Language id for syntax highlighting, when the input is code. */
const EXTENSION_LANG: Record<string, string> = {
  ts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  jsx: 'jsx',
  mjs: 'javascript',
  cjs: 'javascript',
  css: 'css',
  scss: 'scss',
  html: 'html',
  py: 'python',
  sql: 'sql',
  rs: 'rust',
  go: 'go',
  java: 'java',
  rb: 'ruby',
  sh: 'bash',
  toml: 'toml',
  xml: 'xml',
  json: 'json',
  xsd: 'xml',
  xsl: 'xml',
  xslt: 'xml',
  svg: 'xml',
  rss: 'xml',
  atom: 'xml',
  plist: 'xml',
  yml: 'yaml',
  yaml: 'yaml',
  md: 'markdown',
};

export function extensionOf(name: string): string {
  const base = name.toLowerCase().split('/').pop() ?? '';
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1) : '';
}

export function languageOf(name: string): string | undefined {
  return EXTENSION_LANG[extensionOf(name)];
}

/** A NUL byte in the first 8 KB is the classic binary tell. */
export function looksBinary(text: string): boolean {
  return text.slice(0, 8192).includes('\0');
}

function parsesAsJson(text: string): boolean {
  const trimmed = text.trim();
  const looksStructural =
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'));
  if (!looksStructural) return false;
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}

export function detectKind(input: Pick<InputRef, 'name' | 'text' | 'kind'>): InputKind {
  // A folder is known structurally, never sniffed.
  if (input.kind === 'folder') return 'folder';
  // Nor is a git ref: it was constructed by the Git panel, and its display name
  // (`repo @ main`) would otherwise be run through the extension map.
  if (input.kind === 'git') return 'git';

  // A manifest or a lockfile is recognised by its *name*: all four are `.json` or
  // `.yaml` by extension, and a structural diff of two package.json files answers
  // the wrong question (v0.2.10). The engine dropdown still offers JSON.
  if (isDependencyFile(input.name)) return 'deps';

  // An API document is recognised by its *shape*, before the extension map, for the
  // same reason a manifest is recognised by its name (v0.2.10): a HAR and an OpenAPI
  // document are both `.json` — or `.yaml` — and a structural tree of two captures
  // answers a question nobody asked (v0.3.1). Only these two shapes are claimed;
  // two plain response bodies stay JSON, and reach the API engine by choice.
  if (apiShapeOf(input.text) !== null) return 'api';

  const byExtension = EXTENSION_KIND[extensionOf(input.name)];
  if (byExtension) return byExtension;

  const text = input.text;
  // Nothing to sniff: keep whatever the caller already established. Main has
  // usually looked at the bytes by this point, and second-guessing it here would
  // turn a known binary back into an unknown.
  if (text === undefined) return input.kind === 'unknown' ? 'unknown' : input.kind;
  if (looksBinary(text)) return 'binary';
  if (parsesAsJson(text)) return 'json';

  return 'text';
}
