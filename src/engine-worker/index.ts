import { readFile } from 'node:fs/promises';
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
const hostFs: HostFs = {
  readText: (path) => readFile(path, 'utf8'),
  readBytes: async (path) => new Uint8Array(await readFile(path)),
  listDir: async (path) => {
    const { readdir } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const entries = await readdir(path, { withFileTypes: true });
    return entries.map((entry) => ({
      name: entry.name,
      path: join(path, entry.name),
      isDirectory: entry.isDirectory(),
    }));
  },
  stat: async (path) => {
    const { stat } = await import('node:fs/promises');
    const info = await stat(path);
    return { size: info.size, mtimeMs: info.mtimeMs };
  },
};

function send(event: CompareEvent): void {
  process.parentPort.postMessage(event);
}

/** Inline text is used when present; otherwise the bytes are read here. */
async function materialize(payload: InputPayload): Promise<InputRef> {
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
    ref.text = await hostFs.readText(ref.path as string);
  }

  return ref;
}

async function runJob(message: StartMessage): Promise<void> {
  const controller = new AbortController();
  running.set(message.jobId, controller);

  try {
    const [a, b] = await Promise.all([materialize(message.a), materialize(message.b)]);

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
      fs: hostFs,
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
