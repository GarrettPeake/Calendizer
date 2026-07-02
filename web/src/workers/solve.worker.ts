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
import { assembleSchedule, createMilpSolver, type AssembleInput, type MilpMemo, type Solver } from 'calendizer';

/**
 * Memo persistence (IndexedDB): the solver's model→solution cache survives
 * page loads, so a reload's re-solve is warm (seconds) instead of cold
 * (minutes on schedules with structurally-forced conflicts, where every
 * week's overlap optimum is nonzero and expensive to prove). Keys are the
 * FULL model text — identical key ⇒ identical model ⇒ identical solution —
 * so a stale cache can never produce a wrong schedule, only a slower one.
 * Bump MEMO_VERSION when solver/model semantics change to discard old
 * entries wholesale.
 */
const MEMO_VERSION = 1;
const DB_NAME = 'calendizer-solver';
const STORE = 'memo';

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, MEMO_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        // A version bump discards prior caches entirely.
        for (const name of Array.from(db.objectStoreNames)) db.deleteObjectStore(name);
        db.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

type MemoEntry = [string, Array<[string, number]> | null];

async function loadMemo(memo: MilpMemo): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get('entries');
      req.onsuccess = () => {
        const entries = (req.result as MemoEntry[] | undefined) ?? [];
        for (const [k, v] of entries) memo.set(k, v === null ? null : new Map(v));
        resolve();
      };
      req.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
  db.close();
}

async function saveMemo(memo: MilpMemo): Promise<void> {
  const db = await openDb();
  if (!db) return;
  const entries: MemoEntry[] = [...memo.entries()].map(([k, v]) => [k, v === null ? null : [...v.entries()]]);
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(entries, 'entries');
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
  db.close();
}

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
const memo: MilpMemo = new Map();

function getMilp(): Promise<Solver | null> {
  if (!milpPromise) {
    milpPromise = (async () => {
      try {
        const [{ default: loadHighs }, { default: wasmUrl }] = await Promise.all([
          import('highs'),
          import('highs/runtime?url'),
        ]);
        const highs = await loadHighs({ locateFile: () => wasmUrl });
        await loadMemo(memo); // hydrate the cross-session cache before first use
        return createMilpSolver(
          highs,
          {
            onStart(total) {
              weeksDone = 0;
              weeksTotal = total;
              reportProgress?.(0, total);
            },
            onWeek() {
              reportProgress?.(++weeksDone, weeksTotal);
            },
          },
          memo
        );
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
    // Persist any newly-solved models for the next page load (fire and forget).
    if (kind === 'optimize' && solver) void saveMemo(memo);
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
