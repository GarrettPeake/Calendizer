/**
 * The scheduling Web Worker. ALL solving — the greedy preview and the MIP
 * optimize (HiGHS WASM included) — runs here, off the main thread, so the UI
 * never blocks and the browser's "this page is slowing things down" heuristics
 * never fire. The worker is a long-lived singleton: the MIP solver instance
 * (and its model memo) persists across edits, so re-solves only pay for the
 * weeks an edit actually changed.
 *
 * Protocol: { id, kind: 'preview' | 'optimize', input } →
 *           { id, ok: true, result } | { id, ok: false, error }
 * `input` is a full AssembleInput minus the solver (nowDT/today are computed on
 * the MAIN thread so a preview/optimize pair shares the same instant).
 */
import { assembleSchedule, createMilpSolver, type AssembleInput, type Solver } from 'calendizer';

export interface SolveRequest {
  id: number;
  kind: 'preview' | 'optimize';
  input: Omit<AssembleInput, 'solver'>;
}

export interface SolveReply {
  id: number;
  ok: boolean;
  result?: ReturnType<typeof assembleSchedule> & { computedAt: string };
  error?: string;
}

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
        return createMilpSolver(highs);
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
    const r = assembleSchedule({ ...input, solver: solver ?? undefined });
    const reply: SolveReply = { id, ok: true, result: { ...r, computedAt: new Date().toISOString() } };
    self.postMessage(reply);
  } catch (err) {
    const reply: SolveReply = { id, ok: false, error: err instanceof Error ? err.message : String(err) };
    self.postMessage(reply);
  }
};
