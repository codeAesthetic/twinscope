// PLACEHOLDER content that the product cannot produce yet.
//
// The history fixtures left with MVP-8 and the shortcut table with MVP-10,
// which generates it from the real registry. What remains is the quick-start
// deck: two of its four flows (URLs, Git refs) are v0.2.0 features, so the cards
// stay descriptive until then. Kept in one module so each removal is a single
// deletion.
//
// `SAMPLE_PAIR` is the exception and is *not* a placeholder: it is real input to
// a real engine, and the only reason it lives here is that it is content rather
// than logic.

import type { FileKind } from '../components/primitives';

export interface QuickStart {
  id: string;
  kind: FileKind;
  title: string;
  description: string;
}

/** The four fastest ways in (MD §34/§35). Wired up across MVP-2 and v0.2.0. */
export const QUICK_STARTS: readonly QuickStart[] = [
  {
    id: 'folders',
    kind: 'folder',
    title: 'Folders',
    description: 'Recursive tree diff with size & rename hints.',
  },
  {
    id: 'clipboard',
    kind: 'code',
    title: 'Clipboard',
    description: '⌘⇧V twice — text, JSON, URL or image.',
  },
  {
    id: 'screenshots',
    kind: 'image',
    title: 'Screenshots',
    description: 'Overlay, blink and pixel heatmap.',
  },
  {
    id: 'git',
    kind: 'web',
    title: 'Git refs',
    description: 'Branch, tag, commit or range.',
  },
];

export interface SampleInput {
  name: string;
  text: string;
}

/**
 * The pair behind "Load sample comparison" — two revisions of one small module.
 *
 * Deliberately shaped to exercise what the text view can do, because a demo that
 * shows one added line teaches nothing: there are added and removed lines, a
 * modified line whose *words* differ (`3` → `5`, `retries` → `attempts`), a
 * renamed export, and a run of untouched lines long enough that "collapse
 * unchanged" has something to collapse. The `.ts` names are what select the
 * TypeScript grammar for highlighting.
 */
const SAMPLE_BEFORE = `import { readFile } from 'node:fs/promises';

export interface RetryOptions {
  retries: number;
  backoffMs: number;
}

export const DEFAULT_OPTIONS: RetryOptions = {
  retries: 3,
  backoffMs: 250,
};

/** Reads a file, retrying on transient failures. */
export async function loadConfig(path: string, options = DEFAULT_OPTIONS) {
  let lastError: unknown;

  for (let attempt = 0; attempt < options.retries; attempt += 1) {
    try {
      const raw = await readFile(path, 'utf8');
      return JSON.parse(raw) as Record<string, unknown>;
    } catch (cause) {
      lastError = cause;
      await sleep(options.backoffMs * (attempt + 1));
    }
  }

  throw new Error(\`Could not read \${path}\`, { cause: lastError });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isRetryable(error: unknown): boolean {
  return error instanceof Error && error.message.includes('EAGAIN');
}
`;

const SAMPLE_AFTER = `import { readFile } from 'node:fs/promises';

export interface RetryOptions {
  attempts: number;
  backoffMs: number;
  jitter: boolean;
}

export const DEFAULT_OPTIONS: RetryOptions = {
  attempts: 5,
  backoffMs: 250,
  jitter: true,
};

/** Reads a file, retrying on transient failures. */
export async function loadConfig(path: string, options = DEFAULT_OPTIONS) {
  let lastError: unknown;

  for (let attempt = 0; attempt < options.attempts; attempt += 1) {
    try {
      const raw = await readFile(path, 'utf8');
      return JSON.parse(raw) as Record<string, unknown>;
    } catch (cause) {
      lastError = cause;
      await sleep(delayFor(options, attempt));
    }
  }

  throw new Error(\`Could not read \${path}\`, { cause: lastError });
}

function delayFor(options: RetryOptions, attempt: number): number {
  const base = options.backoffMs * (attempt + 1);
  return options.jitter ? base * (0.5 + Math.random()) : base;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
`;

export const SAMPLE_PAIR: { before: SampleInput; after: SampleInput } = {
  before: { name: 'loadConfig.ts', text: SAMPLE_BEFORE },
  after: { name: 'loadConfig.ts', text: SAMPLE_AFTER },
};
