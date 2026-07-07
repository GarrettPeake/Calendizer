/**
 * Main-thread client for the scheduling Web Worker (see workers/solve.worker.ts).
 * Lazy singleton; request/response matched by id; optional per-request progress
 * callback (weeks solved / total — a REAL progress signal, not a fake bar). If
 * the worker can't be created or dies, callers fall back to the synchronous
 * main-thread solve.
 *
 * Single-flight optimize gating: the worker computes solves synchronously, so
 * without gating N rapid edits queue N full solves and the surviving result
 * lands after N×solve-time. Instead at most ONE optimize is in flight plus ONE
 * parked "latest" request; an edit arriving while one is parked REPLACES the
 * parked inputs, and the superseded callers ride along on the newest solve's
 * result (the App's sequence token already discards stale results, so handing
 * an old caller a newer schedule is indistinguishable from today's behavior —
 * minus the wasted computation).
 */
import type { GlobalConfig, Instance } from 'calendizer';
import type { ModeRecord } from '../api';
import type { ClientSchedule } from './solve';
import type { SolveRequest, WorkerMessage } from '../workers/solve.worker';

interface Pending {
  resolve: (r: ClientSchedule) => void;
  reject: (e: Error) => void;
  onProgress?: (done: number, total: number) => void;
}

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, Pending[]>();
let inflightOptimize: number | null = null;
let parkedOptimize: { req: SolveRequest; waiters: Pending[] } | null = null;

function failAll(err: Error): void {
  for (const [, waiters] of pending) for (const w of waiters) w.reject(err);
  pending.clear();
  if (parkedOptimize) {
    for (const w of parkedOptimize.waiters) w.reject(err);
    parkedOptimize = null;
  }
  inflightOptimize = null;
}

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('../workers/solve.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<WorkerMessage>) => {
      const waiters = pending.get(e.data.id);
      if (!waiters) return;
      if (e.data.type === 'progress') {
        for (const w of waiters) w.onProgress?.(e.data.done, e.data.total);
        return;
      }
      pending.delete(e.data.id);
      if (e.data.id === inflightOptimize) {
        inflightOptimize = null;
        if (parkedOptimize) {
          const next = parkedOptimize;
          parkedOptimize = null;
          dispatch(next.req, next.waiters);
        }
      }
      if (e.data.ok) {
        const result = e.data.result as ClientSchedule;
        for (const w of waiters) w.resolve(result);
      } else {
        const err = new Error(e.data.error ?? 'solve worker error');
        for (const w of waiters) w.reject(err);
      }
    };
    worker.onerror = (e) => {
      // Fail everything in flight; callers fall back to the main thread.
      failAll(new Error(e.message || 'solve worker crashed'));
      worker?.terminate();
      worker = null;
    };
  }
  return worker;
}

function dispatch(req: SolveRequest, waiters: Pending[]): void {
  pending.set(req.id, waiters);
  try {
    getWorker().postMessage(req);
    if (req.kind === 'optimize') inflightOptimize = req.id;
  } catch (e) {
    pending.delete(req.id);
    if (req.kind === 'optimize') inflightOptimize = null;
    const err = e instanceof Error ? e : new Error(String(e));
    for (const w of waiters) w.reject(err);
  }
}

/** Current wall-clock "YYYY-MM-DDTHH:MM" in the user's fixed offset. */
export function nowInOffset(offsetMinutes: number): string {
  return new Date(Date.now() + offsetMinutes * 60_000).toISOString().slice(0, 16);
}

export function solveInWorker(
  kind: 'preview' | 'optimize',
  config: GlobalConfig,
  intents: SolveRequest['input']['intents'],
  modes: ModeRecord[],
  previous: Instance[],
  nowDT: string,
  opts?: { onProgress?: (done: number, total: number) => void }
): Promise<ClientSchedule> {
  const id = nextId++;
  const req: SolveRequest = {
    id,
    kind,
    input: { config, intents, modeRecords: modes, frozen: previous, nowDT, today: nowDT.slice(0, 10) },
  };
  return new Promise<ClientSchedule>((resolve, reject) => {
    const p: Pending = { resolve, reject, onProgress: opts?.onProgress };
    if (kind === 'optimize' && inflightOptimize !== null) {
      // Coalesce: the newest inputs win; earlier parked callers ride along.
      const waiters = parkedOptimize?.waiters ?? [];
      waiters.push(p);
      parkedOptimize = { req, waiters };
      return;
    }
    dispatch(req, [p]);
  });
}
