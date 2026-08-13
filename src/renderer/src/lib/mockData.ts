// Content rather than logic — and no longer placeholder content.
//
// The history fixtures left with MVP-8, the shortcut table with MVP-10 (which
// generates it from the real registry), and the sidebar's pinned cards with
// v0.2.9. What remains is the quick-start deck and `SAMPLE_PAIR`, and **both are
// real**: every card now names the action it performs, and the sample is real
// input to a real engine. They live here because they are copy, not because they
// are fake.

import type { FileKind } from '../components/primitives';

export interface QuickStart {
  id: string;
  kind: FileKind;
  title: string;
  description: string;
  /**
   * What clicking it does.
   *
   * An id from `lib/shortcuts.ts` wherever one exists, so a card and its keyboard
   * shortcut run the same code — the rule ⌘S follows, and the reason these are not
   * three `onClick` handlers in the component. `git-panel` is the exception: the
   * panel is a mode of the Compare screen, so only that screen can open it.
   */
  action: string;
  /** The tooltip. Says what will happen, since the card does not look like a button. */
  hint: string;
}

/** The four fastest ways in (MD §34/§35). Every one of them live since 2026-08-13. */
export const QUICK_STARTS: readonly QuickStart[] = [
  {
    id: 'folders',
    kind: 'folder',
    title: 'Folders',
    description: 'Recursive tree diff with size & rename hints.',
    action: 'open-folders',
    hint: 'Choose the BEFORE folder, then the AFTER folder (⌘⇧O)',
  },
  {
    id: 'clipboard',
    kind: 'code',
    title: 'Clipboard',
    description: '⌘⇧V twice — text, JSON, URL or image.',
    action: 'paste-compare',
    hint: 'Paste into the first empty side. Click again for the other one (⌘⇧V)',
  },
  {
    id: 'screenshots',
    kind: 'image',
    title: 'Screenshots',
    description: 'Overlay, blink and pixel heatmap.',
    // The file picker, not an image-only one: `pickFile` takes no filters, and the
    // image engine is chosen by detection once both sides are in. A card that
    // refused a PDF here would be a card lying about which engine runs.
    action: 'open-files',
    hint: 'Choose two images to compare (⌘O)',
  },
  {
    id: 'git',
    kind: 'web',
    title: 'Git refs',
    description: 'Branch, tag, commit or range.',
    action: 'git-panel',
    hint: 'Pick a repository and two refs',
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
