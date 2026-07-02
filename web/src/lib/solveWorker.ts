/**
 * Main-thread client for the scheduling Web Worker (see workers/solve.worker.ts).
 * Lazy singleton; request/response matched by id. If the worker can't be
 * created or dies, callers fall back to the synchronous main-thread solve.
 */
import type { GlobalConfig, Instance } from 'calendizer';
import type { ModeRecord } from '../api';
import type { ClientSchedule } from './solve';
import type { SolveReply, SolveRequest } from '../workers/solve.worker';

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (r: ClientSchedule) => void; reject: (e: Error) => void }>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('../workers/solve.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<SolveReply>) => {
      const req = pending.get(e.data.id);
      if (!req) return;
      pending.delete(e.data.id);
      if (e.data.ok && e.data.result) req.resolve(e.data.result as ClientSchedule);
      else req.reject(new Error(e.data.error ?? 'solve worker error'));
    };
    worker.onerror = (e) => {
      // Fail everything in flight; callers fall back to the main thread.
      for (const [, req] of pending) req.reject(new Error(e.message || 'solve worker crashed'));
      pending.clear();
      worker?.terminate();
      worker = null;
    };
  }
  return worker;
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
  nowDT: string
): Promise<ClientSchedule> {
  const id = nextId++;
  const req: SolveRequest = {
    id,
    kind,
    input: { config, intents, modeRecords: modes, frozen: previous, nowDT, today: nowDT.slice(0, 10) },
  };
  return new Promise<ClientSchedule>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    try {
      getWorker().postMessage(req);
    } catch (e) {
      pending.delete(id);
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}
