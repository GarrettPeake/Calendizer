/**
 * Speculation pool worker (spawned BY the solve worker, one per core slice):
 * pre-solves a shard of phase-A week models with its own HiGHS instance so
 * the solve worker's sequential pass memo-hits them. Soundness is by
 * construction (see speculatePhaseA): entries carry the same input-hash keys
 * the sequential loop computes, and solves are deterministic per
 * (model, seed) — merged entries change which solves are free, never the
 * output. A missing/failed pool degrades to the sequential solve.
 */
import { prepareSolve, speculatePhaseA, type AssembleInput } from 'calendizer';
import type { HighsInstance } from 'calendizer';

export interface SpecRequest {
  id: number;
  input: Omit<AssembleInput, 'solver'>;
  shardIndex: number;
  shardCount: number;
  /** Memo keys the solve worker already has — skip solving those. */
  knownKeys: string[];
}

export type SpecMessage =
  | { id: number; type: 'tick' }
  | { id: number; type: 'done'; entries: Array<[string, Array<[string, number]> | null]> };

let highsPromise: Promise<HighsInstance | null> | null = null;
function getHighs(): Promise<HighsInstance | null> {
  if (!highsPromise) {
    highsPromise = (async () => {
      try {
        const [{ default: loadHighs }, { default: wasmUrl }] = await Promise.all([
          import('highs'),
          import('highs/runtime?url'),
        ]);
        return await loadHighs({ locateFile: () => wasmUrl });
      } catch {
        return null;
      }
    })();
  }
  return highsPromise;
}

self.onmessage = async (e: MessageEvent<SpecRequest>) => {
  const { id, input, shardIndex, shardCount, knownKeys } = e.data;
  try {
    const highs = await getHighs();
    if (!highs) {
      self.postMessage({ id, type: 'done', entries: [] } satisfies SpecMessage);
      return;
    }
    const { solveInput } = prepareSolve(input as AssembleInput);
    const entries = speculatePhaseA(highs, solveInput, shardIndex, shardCount, new Set(knownKeys), () =>
      self.postMessage({ id, type: 'tick' } satisfies SpecMessage)
    );
    self.postMessage({
      id,
      type: 'done',
      entries: entries.map(([k, v]) => [k, v === null ? null : [...v.entries()]] as [string, Array<[string, number]> | null]),
    } satisfies SpecMessage);
  } catch {
    self.postMessage({ id, type: 'done', entries: [] } satisfies SpecMessage);
  }
};
