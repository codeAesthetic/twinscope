import { folderEngine } from './folder';
import { jsonEngine } from './json';
import { textEngine } from './text';
import { NotImplementedError } from './types';
import type { DiffEngine, InputRef } from './types';

/**
 * The four MVP engines (MD §55: start with exactly these).
 *
 * `canHandle` is real — engine selection is testable today. `compare` throws
 * until each engine's feature lands: text (MVP-4), json (MVP-5) and folder
 * (MVP-6) are real engines now; image (MVP-7) is the last stub here.
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
