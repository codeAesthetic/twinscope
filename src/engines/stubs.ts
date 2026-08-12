import { NotImplementedError } from './types';
import type { DiffEngine, InputRef } from './types';

/**
 * The four MVP engines (MD §55: start with exactly these).
 *
 * `canHandle` is real — engine selection is testable today. `compare` throws
 * until each engine's feature lands: text MVP-4, json MVP-5, folder MVP-6,
 * image MVP-7.
 */

function stub<TOptions extends object>(
  meta: DiffEngine['meta'],
  canHandle: (a: InputRef, b: InputRef) => boolean,
  defaults: TOptions,
): DiffEngine<TOptions> {
  return {
    meta,
    canHandle,
    defaultOptions: () => ({ ...defaults }),
    compare: () => Promise.reject(new NotImplementedError(meta.id)),
  };
}

const bothAre = (kind: string) => (a: InputRef, b: InputRef) => a.kind === kind && b.kind === kind;

export const folderEngine = stub(
  { id: 'folder', label: 'File tree diff', priority: 40 },
  bothAre('folder'),
  { detectRenames: true, compareContentHash: true, ignore: ['.git', 'node_modules', '.DS_Store'] },
);

export const imageEngine = stub(
  { id: 'image', label: 'Visual / pixel diff', priority: 30 },
  bothAre('image'),
  { threshold: 0.12, showRegions: true },
);

export const jsonEngine = stub(
  { id: 'json', label: 'Structural JSON diff', priority: 20 },
  bothAre('json'),
  { ignoreKeyOrder: true, ignoreNulls: false, ignoreArrayOrder: true, ignorePaths: [] as string[] },
);

/**
 * The universal fallback: anything textual can be line-diffed, so this accepts
 * any pair no more specific engine claimed. Lowest priority by definition.
 */
export const textEngine = stub(
  { id: 'text', label: 'Text diff', priority: 0 },
  (a, b) => {
    const comparable = new Set(['text', 'code', 'json', 'yaml', 'csv', 'md']);
    return comparable.has(a.kind) && comparable.has(b.kind);
  },
  { ignoreWhitespace: true, ignoreCase: false, collapseUnchanged: true },
);

/**
 * Options are erased to `unknown` in the registry: callers pick an engine
 * first, then read its own `defaultOptions()` for the concrete shape.
 */
export const ENGINES: readonly DiffEngine<unknown>[] = [
  folderEngine,
  imageEngine,
  jsonEngine,
  textEngine,
];
