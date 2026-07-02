/**
 * The scheduling Web Worker. ALL solving — the greedy preview and the MIP
 * optimize (HiGHS WASM included) — runs here, off the main thread, so the UI
 * never blocks and the browser's "this page is slowing things down" heuristics
 * never fire. The worker is a long-lived singleton: the MIP solver instance
 * (and its model memo) persists across edits, so re-solves only pay for the
 * weeks an edit actually changed.
 *
 * Protocol:
 *   in : { id, kind: 'preview' | 'optimize', input }
 *   out: { id, type: 'progress', done, total }   (optimize only, per solved week)
 *        { id, type: 'result', ok, result?, error? }
 * `input` is a full AssembleInput minus the solver (nowDT/today are computed on
 * the MAIN thread so a preview/optimize pair shares the same instant).
 */
import { assembleSchedule, createMilpSolver, type AssembleInput, type Solver } from 'calendizer';

export interface SolveRequest {
  id: number;
  kind: 'preview' | 'optimize';
  input: Omit<AssembleInput, 'solver'>;
}

export type WorkerMessage =
  | { id: number; type: 'progress'; done: number; total: number }
  | { id: number; type: 'result'; ok: true; result: ReturnType<typeof assembleSchedule> & { computedAt: string } }
  | { id: number; type: 'result'; ok: false; error: string };

// Progress routing: the worker's event loop serializes solves (they're
// synchronous), so one mutable target is safe.
let reportProgress: ((done: number, total: number) => void) | null = null;
let weeksDone = 0;
let weeksTotal = 0;

let milpPromise: Promise<Solver | null> | null = null;

function getMilp(): Promise<Solver | null> {
  if (!milpPromise) {
    milpPromise = (async () => {
      try {
        const [{ default: loadHighs }, { default: wasmUrl }] = await Promise.all([
          import('highs'),
          import('highs/runtime?url'),
        ]);
        const highs = await loadHighs({ locateFile: () => wasmUrl });
        return createMilpSolver(highs, {
          onStart(total) {
            weeksDone = 0;
            weeksTotal = total;
            reportProgress?.(0, total);
          },
          onWeek() {
            reportProgress?.(++weeksDone, weeksTotal);
          },
        });
      } catch {
        return null; // WASM unavailable → optimize degrades to the greedy result
      }
    })();
  }
  return milpPromise;
}

self.onmessage = async (e: MessageEvent<SolveRequest>) => {
  const { id, kind, input } = e.data;
  try {
    const solver = kind === 'optimize' ? await getMilp() : null;
    reportProgress =
      kind === 'optimize'
        ? (done, total) => self.postMessage({ id, type: 'progress', done, total } satisfies WorkerMessage)
        : null;
    const r = assembleSchedule({ ...input, solver: solver ?? undefined });
    reportProgress = null;
    self.postMessage({
      id,
      type: 'result',
      ok: true,
      result: { ...r, computedAt: new Date().toISOString() },
    } satisfies WorkerMessage);
  } catch (err) {
    reportProgress = null;
    self.postMessage({
      id,
      type: 'result',
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    } satisfies WorkerMessage);
  }
};
