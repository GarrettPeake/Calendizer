/**
 * Lazy singleton for the MIP solver. The HiGHS WASM (~1 MB gz) loads as its own
 * chunk on first use — the entry bundle stays lean and the app is fully usable
 * on the greedy engine before (or without) it. The returned solver instance is
 * shared so its model memo persists across edits: re-solving after a change
 * only pays for the weeks the change actually touched.
 */
import { createMilpSolver, type Solver } from 'calendizer';

let promise: Promise<Solver | null> | null = null;

export function loadMilp(): Promise<Solver | null> {
  if (!promise) {
    promise = (async () => {
      try {
        const [{ default: loadHighs }, { default: wasmUrl }] = await Promise.all([
          import('highs'),
          import('highs/runtime?url'),
        ]);
        const highs = await loadHighs({ locateFile: () => wasmUrl });
        return createMilpSolver(highs);
      } catch {
        return null; // load failure → the app stays on greedy, gracefully
      }
    })();
  }
  return promise;
}
