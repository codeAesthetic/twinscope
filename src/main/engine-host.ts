import { utilityProcess, type UtilityProcess, type WebContents } from 'electron';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { engineById, selectEngine } from '../engines/registry';
import { refFromPayload } from '../shared/inputRef';
import {
  IPC,
  type CompareEvent,
  type CompareRequest,
  type CompareStarted,
} from '../shared/channels';

/**
 * Owns the engine worker process and the jobs running inside it.
 *
 * The worker is spawned lazily on the first comparison and reused after that —
 * forking costs ~50ms, and a warm process keeps the second comparison instant.
 * If it dies, every in-flight job is failed with a `crash` reason and the next
 * request spawns a fresh one, so a bad engine cannot leave the app wedged.
 */

const MAX_RESTARTS = 3;

interface Job {
  id: string;
  webContents: WebContents;
}

let worker: UtilityProcess | null = null;
let restarts = 0;
const jobs = new Map<string, Job>();

function workerPath(): string {
  // Built alongside main by electron-vite (see electron.vite.config.ts).
  return join(__dirname, 'engine-worker.js');
}

function emit(job: Job, event: CompareEvent): void {
  if (job.webContents.isDestroyed()) return;
  job.webContents.send(IPC.compareEvent, event);
}

function failAll(reason: 'crash', message: string): void {
  for (const job of jobs.values()) {
    emit(job, { type: 'error', jobId: job.id, message, reason });
  }
  jobs.clear();
}

function spawnWorker(): UtilityProcess {
  const child = utilityProcess.fork(workerPath(), [], {
    serviceName: 'twinscope-engine-host',
    stdio: 'inherit',
  });

  child.on('message', (event: CompareEvent) => {
    const job = jobs.get(event.jobId);
    if (!job) return;

    emit(job, event);
    if (event.type === 'done' || event.type === 'error') jobs.delete(event.jobId);
  });

  child.on('exit', (code) => {
    worker = null;

    if (jobs.size > 0) {
      console.error(`[engine-host] worker exited (code ${code}) with ${jobs.size} job(s) running`);
      failAll('crash', 'The comparison engine stopped unexpectedly. Try again.');
    }
  });

  return child;
}

/** Lazily spawns, and refuses to loop forever if the worker keeps dying. */
function ensureWorker(): UtilityProcess {
  if (worker) return worker;

  if (restarts >= MAX_RESTARTS) {
    throw new Error(
      'The comparison engine failed to start repeatedly. Restart TwinScope to try again.',
    );
  }

  restarts += 1;
  worker = spawnWorker();
  return worker;
}

/**
 * Resolve the engine up front so the UI can name it before work begins.
 *
 * This id is also what the worker is told to run, so the projection has to carry
 * everything `canHandle` reads — `refFromPayload` exists because the copy that
 * used to live here dropped `path`, and v0.2.8's engine selects on it.
 */
function resolveEngine(request: CompareRequest): { id: string; label: string } {
  const engine = request.engineId
    ? engineById(request.engineId)
    : selectEngine(refFromPayload(request.a), refFromPayload(request.b));

  if (!engine) {
    throw new Error(`No engine can compare ${request.a.kind} against ${request.b.kind}.`);
  }

  return { id: engine.meta.id, label: engine.meta.label };
}

export function startComparison(webContents: WebContents, request: CompareRequest): CompareStarted {
  const engine = resolveEngine(request);
  const child = ensureWorker();
  const jobId = randomUUID();

  jobs.set(jobId, { id: jobId, webContents });

  child.postMessage({
    type: 'start',
    jobId,
    a: request.a,
    b: request.b,
    engineId: engine.id,
    ...(request.options !== undefined ? { options: request.options } : {}),
  });

  return { jobId, engineId: engine.id, engineLabel: engine.label };
}

export function cancelComparison(jobId: string): void {
  if (!jobs.has(jobId)) return;
  worker?.postMessage({ type: 'cancel', jobId });
}

/** Called on app quit so a busy worker cannot outlive the window. */
export function shutdownEngineHost(): void {
  jobs.clear();
  worker?.kill();
  worker = null;
}

/** Test seam: lets the harness prove a crash is survivable. */
export function killWorkerForTesting(): boolean {
  if (!worker) return false;
  worker.kill();
  return true;
}
