import { detectKind } from './detect';
import { ENGINES } from './stubs';
import type { DiffEngine, InputRef } from './types';

/**
 * Engine selection: the highest-priority engine that claims the pair.
 *
 * Mismatched kinds (a JSON against a YAML, say) fall through to the text
 * engine rather than failing — the user still gets a useful comparison, and the
 * UI explains which engine ran.
 */
export function selectEngine(a: InputRef, b: InputRef): DiffEngine<unknown> | undefined {
  return [...ENGINES]
    .sort((left, right) => right.meta.priority - left.meta.priority)
    .find((engine) => engine.canHandle(a, b));
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

export { ENGINES } from './stubs';
