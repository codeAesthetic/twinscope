import { jsonEngine } from './json';
import { textEngine } from './text';
import { NotImplementedError } from './types';
import type { DiffEngine, InputRef } from './types';

/**
 * The four MVP engines (MD §55: start with exactly these).
 *
 * `canHandle` is real — engine selection is testable today. `compare` throws
 * until each engine's feature lands: text MVP-4 and json MVP-5 are real engines
 * now; folder MVP-6 and image MVP-7 are still stubs here.
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
