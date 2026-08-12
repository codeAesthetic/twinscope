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

/** Convenience for intake: detect both sides, then pick. */
export function selectEngineForInputs(
  a: Pick<InputRef, 'name' | 'text' | 'kind'>,
  b: Pick<InputRef, 'name' | 'text' | 'kind'>,
): {
  engine: DiffEngine<unknown> | undefined;
  kinds: [ReturnType<typeof detectKind>, ReturnType<typeof detectKind>];
} {
  const kindA = detectKind(a);
  const kindB = detectKind(b);
  const refA = { ...a, kind: kindA, side: 'A', size: 0 } as InputRef;
  const refB = { ...b, kind: kindB, side: 'B', size: 0 } as InputRef;
  return { engine: selectEngine(refA, refB), kinds: [kindA, kindB] };
}

export { ENGINES } from './catalog';
export { demoEngine } from './demo';
