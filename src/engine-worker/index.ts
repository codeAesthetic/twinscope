import { nodeHostFs, scopedHostFs } from './hostFs';
import { engineById, selectEngine } from '../engines/registry';
import { EngineInputError } from '../engines/types';
import type { EngineCtx, HostFs, InputRef } from '../engines/types';
import type { CompareEvent, InputPayload } from '../shared/channels';

/**
 * The engine host worker — an Electron `utilityProcess`.
 *
 * Why a separate process at all: comparisons are CPU-bound (LCS over large
 * files, pixel loops, folder walks) and MD §30 requires the UI never block. A
 * worker also means a runaway engine can be killed without taking the app down.
 *
 * This is a plain Node process: no Electron APIs, no DOM. It may use `fs`, and
 * it is the only place that reads comparison input off disk.
 */

interface StartMessage {
  type: 'start';
  jobId: string;
  a: InputPayload;
  b: InputPayload;
  engineId?: string;
  options?: Record<string, unknown>;
}

interface CancelMessage {
  type: 'cancel';
  jobId: string;
}

type IncomingMessage = StartMessage | CancelMessage;

const running = new Map<string, AbortController>();

/** Filesystem access handed to engines, so they never import `fs` themselves. */
const hostFs: HostFs = nodeHostFs;

/**
 * The same filesystem, confined to the two inputs of one job (plan §3.7).
 *
 * A comparison has no business reading anything the user did not choose, and a
 * folder scan must not follow a symlink out of the tree it was pointed at.
 */
function fsForJob(message: StartMessage): HostFs {
  const roots = [message.a.path, message.b.path].filter(
    (path): path is string => typeof path === 'string' && path !== '',
  );
  // Nothing to confine to — an all-clipboard comparison never touches the disk.
  return roots.length === 0 ? hostFs : scopedHostFs(hostFs, roots);
}

function send(event: CompareEvent): void {
  process.parentPort.postMessage(event);
}

/** Inline text is used when present; otherwise the bytes are read here. */
async function materialize(payload: InputPayload, fs: HostFs): Promise<InputRef> {
  const ref: InputRef = {
    side: payload.side,
    kind: payload.kind,
    name: payload.name,
    size: payload.size,
    ...(payload.path !== undefined ? { path: payload.path } : {}),
    ...(payload.lang !== undefined ? { lang: payload.lang } : {}),
    ...(payload.text !== undefined ? { text: payload.text } : {}),
  };

  const needsText =
    ref.text === undefined &&
    ref.path !== undefined &&
    ref.kind !== 'folder' &&
    ref.kind !== 'image';

  if (needsText) {
    ref.text = await fs.readText(ref.path as string);
  }

  return ref;
}

async function runJob(message: StartMessage): Promise<void> {
  const controller = new AbortController();
  running.set(message.jobId, controller);

  try {
    const jobFs = fsForJob(message);
    const [a, b] = await Promise.all([
      materialize(message.a, jobFs),
      materialize(message.b, jobFs),
    ]);

    const engine = message.engineId ? engineById(message.engineId) : selectEngine(a, b);
    if (!engine) {
      send({
        type: 'error',
        jobId: message.jobId,
        message: `No engine can compare ${a.kind} against ${b.kind}.`,
        reason: 'failed',
      });
      return;
    }

    const ctx: EngineCtx = {
      signal: controller.signal,
      progress: (percent, text) =>
        send({
          type: 'progress',
          jobId: message.jobId,
          percent: Math.max(0, Math.min(100, Math.round(percent))),
          ...(text !== undefined ? { message: text } : {}),
        }),
      fs: jobFs,
    };

    const options = { ...(engine.defaultOptions() as object), ...(message.options ?? {}) };
    const result = await engine.compare(a, b, options, ctx);

    send({
      type: 'done',
      jobId: message.jobId,
      engineId: result.engineId,
      summary: result.summary,
      data: result.data,
      normalizationNotes: result.normalizationNotes,
      ms: result.timings.ms,
    });
  } catch (cause) {
    const cancelled =
      controller.signal.aborted || (cause instanceof Error && cause.name === 'AbortError');
    const fallback = !cancelled && cause instanceof EngineInputError ? cause.fallback : undefined;
    const fallbackEngine =
      fallback !== undefined ? engineById(fallback.fallbackEngineId) : undefined;

    send({
      type: 'error',
      jobId: message.jobId,
      message: cancelled
        ? 'Comparison cancelled.'
        : cause instanceof Error
          ? cause.message
          : String(cause),
      reason: cancelled ? 'cancelled' : 'failed',
      ...(fallback !== undefined && fallbackEngine !== undefined
        ? { fallback: { engineId: fallbackEngine.meta.id, label: fallback.fallbackLabel } }
        : {}),
    });
  } finally {
    running.delete(message.jobId);
  }
}

process.parentPort.on('message', (event) => {
  const message = event.data as IncomingMessage;

  if (message.type === 'start') {
    void runJob(message);
    return;
  }

  if (message.type === 'cancel') {
    // Cooperative: abort the signal and let the engine unwind. Engines that
    // ignore it get killed by the host's timeout instead.
    running.get(message.jobId)?.abort();
  }
});
