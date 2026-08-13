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
  xml: 'code',
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
