import { demoEngine } from './demo';
import { detectKind } from './detect';
import { ENGINES } from './catalog';
import type { DiffEngine, InputRef } from './types';

/** Every engine the host can run, including ones detection never picks. */
const ALL: readonly DiffEngine<unknown>[] = [
  ...ENGINES,
  demoEngine as unknown as DiffEngine<unknown>,
];

/**
 * Engine selection: the highest-priority engine that claims the pair.
 *
 * Mismatched kinds (a JSON against a YAML, say) fall through to the text engine
 * rather than failing — the user still gets a useful comparison, and the UI
 * explains which engine ran.
 */
export function selectEngine(a: InputRef, b: InputRef): DiffEngine<unknown> | undefined {
  return [...ALL]
    .sort((left, right) => right.meta.priority - left.meta.priority)
    .find((engine) => engine.canHandle(a, b));
}

/** Look an engine up by id, for when the caller names one explicitly. */
export function engineById(id: string): DiffEngine<unknown> | undefined {
  return ALL.find((engine) => engine.meta.id === id);
}

/**
 * Convenience for intake: detect both sides, then pick.
 *
 * `size` and `path` are part of the input, not decoration: since v0.2.8 an engine
 * can claim a pair *because* of how big it is, and dropping those two fields here
 * made the bar name one engine while the worker — which has the whole payload —
 * ran another.
 */
export function selectEngineForInputs(
  a: Pick<InputRef, 'name' | 'text' | 'kind'> & Partial<Pick<InputRef, 'size' | 'path'>>,
  b: Pick<InputRef, 'name' | 'text' | 'kind'> & Partial<Pick<InputRef, 'size' | 'path'>>,
): {
  engine: DiffEngine<unknown> | undefined;
  kinds: [ReturnType<typeof detectKind>, ReturnType<typeof detectKind>];
} {
  const kindA = detectKind(a);
  const kindB = detectKind(b);
  const refA = { size: 0, ...a, kind: kindA, side: 'A' } as InputRef;
  const refB = { size: 0, ...b, kind: kindB, side: 'B' } as InputRef;
  return { engine: selectEngine(refA, refB), kinds: [kindA, kindB] };
}

export { ENGINES } from './catalog';
export { demoEngine } from './demo';
