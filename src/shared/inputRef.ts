import type { InputPayload } from './channels';
import type { InputRef } from '../engines/types';

/**
 * One `InputPayload` → `InputRef` projection, for everything that has to ask an
 * engine "could you handle this?" before the job starts.
 *
 * There were three hand-written copies of this — the detected bar, the compare
 * store and `main/engine-host.ts` — and each listed the fields its author needed
 * at the time. That was invisible until v0.2.8 added an engine whose `canHandle`
 * reads `size` **and** `path`: main's copy omitted `path`, so it resolved `text`,
 * passed that id to the worker (which then never re-selects), and the app
 * line-diffed a file the bar had just promised to index. The bug was not a wrong
 * field, it was three lists that could disagree.
 *
 * No runtime dependency, so anywhere may import it — but note this is *not*
 * `channels.ts`: that file is in the sandboxed preload's bundle and stays
 * type-only.
 */
export function refFromPayload(payload: InputPayload): InputRef {
  return {
    side: payload.side,
    kind: payload.kind,
    name: payload.name,
    size: payload.size,
    ...(payload.path !== undefined ? { path: payload.path } : {}),
    ...(payload.text !== undefined ? { text: payload.text } : {}),
    ...(payload.lang !== undefined ? { lang: payload.lang } : {}),
    ...(payload.ref !== undefined ? { ref: payload.ref } : {}),
  };
}
