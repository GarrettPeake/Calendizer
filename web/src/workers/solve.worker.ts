/**
 * The scheduling Web Worker. ALL solving — the greedy preview and the bubble
 * optimize — runs here, off the main thread, so the UI never blocks. The
 * bubble solver is pure TypeScript (no WASM, no persistent cache): a full-year
 * optimize is seconds at worst, and re-solves warm-start from the previously
 * published calendar (`templateHint` inside the input), so unchanged inputs
 * reproduce the published schedule instead of churning it.
 *
 * Protocol:
 *   in : { id, kind: 'preview' | 'optimize', input }
 *        { id, kind: 'warmup' }                       (boots the worker; no-op)
 *   out: { id, type: 'progress', done, total }   (optimize only, per solved week)
 *        { id, type: 'result', ok, result?, error? }
 * `input` is a full AssembleInput minus the solver (nowDT/today are computed on
 * the MAIN thread so a preview/optimize pair shares the same instant).
 */
import { assembleSchedule, createBubbleSolver, type AssembleInput } from 'calendizer';

export interface SolveRequest {
  id: number;
  kind: 'preview' | 'optimize' | 'warmup';
  input?: Omit<AssembleInput, 'solver'>;
}

export type WorkerMessage =
  | { id: number; type: 'progress'; done: number; total: number }
  | { id: number; type: 'result'; ok: true; result: (ReturnType<typeof assembleSchedule> & { computedAt: string }) | null }
  | { id: number; type: 'result'; ok: false; error: string };

// Progress routing: the worker's event loop serializes solves (they're
// synchronous), so one mutable target is safe.
let reportProgress: ((done: number, total: number) => void) | null = null;
let weeksDone = 0;
let weeksTotal = 0;

const bubble = createBubbleSolver({}, {
  onStart(total) {
    weeksDone = 0;
    weeksTotal = total;
    reportProgress?.(0, total);
  },
  onWeek() {
    reportProgress?.(++weeksDone, weeksTotal);
  },
});

self.onmessage = (e: MessageEvent<SolveRequest>) => {
  const { id, kind, input } = e.data;
  try {
    if (kind === 'warmup') {
      // Nothing to prefetch anymore — the reply just confirms the worker booted.
      self.postMessage({ id, type: 'result', ok: true, result: null } satisfies WorkerMessage);
      return;
    }
    reportProgress =
      kind === 'optimize'
        ? (done, total) => self.postMessage({ id, type: 'progress', done, total } satisfies WorkerMessage)
        : null;
    const r = assembleSchedule({
      ...(input as Omit<AssembleInput, 'solver'>),
      solver: kind === 'optimize' ? bubble : undefined,
    });
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
