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
 *        { id, kind: 'warmup' }                       (prefetch WASM + memo)
 *   out: { id, type: 'progress', done, total }   (optimize only, per solved week)
 *        { id, type: 'result', ok, result?, error? }
 * `input` is a full AssembleInput minus the solver (nowDT/today are computed on
 * the MAIN thread so a preview/optimize pair shares the same instant).
 */
import { assembleSchedule, createMilpSolver, type AssembleInput, type MilpMemo, type Solver } from 'calendizer';

/**
 * Memo persistence (IndexedDB): the solver's (input-hash → solution) cache
 * survives page loads, so a reload's re-solve is warm instead of cold. Keys
 * hash the FULL model inputs INCLUDING the seed — stages are bounded searches,
 * so only the exact (model, seed) pair may be replayed.
 *
 * Layout: one row per memo key (values array), stamped with a monotonic `t`
 * for FIFO eviction at MAX_ROWS — eviction only affects the CACHE (evicted
 * models re-solve deterministically to the identical answer). Saves write
 * ONLY keys added since the last save, never the whole cache. Null entries
 * ("solve failed, keep the seed") stay in-memory for the session and are
 * never persisted: an environment-transient failure (WASM hiccup, memory
 * pressure) must not pin a week to its greedy seed forever.
 *
 * Bump MEMO_VERSION when solver/model/key semantics change to discard old
 * entries wholesale.
 */
const MEMO_VERSION = 3; // v3: input-hash keys, per-key rows, FIFO cap
const DB_NAME = 'calendizer-solver';
const STORE = 'memo';
const MAX_ROWS = 1000;

interface MemoRow {
  v: Array<[string, number]>;
  t: number;
}

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, MEMO_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        // A version bump discards prior caches entirely.
        for (const name of Array.from(db.objectStoreNames)) db.deleteObjectStore(name);
        db.createObjectStore(STORE).createIndex('t', 't');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/** Keys already present in (or written to) IndexedDB — the dirty-set's complement. */
const persisted = new Set<string>();
let saveSeq = 0;

async function loadMemo(memo: MilpMemo): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readonly');
      const store = tx.objectStore(STORE);
      const keysReq = store.getAllKeys();
      const valsReq = store.getAll();
      tx.oncomplete = () => {
        const keys = (keysReq.result as string[]) ?? [];
        const rows = (valsReq.result as MemoRow[]) ?? [];
        for (let i = 0; i < keys.length && i < rows.length; i++) {
          memo.set(keys[i], new Map(rows[i].v));
          persisted.add(keys[i]);
          if (rows[i].t > saveSeq) saveSeq = rows[i].t;
        }
        resolve();
      };
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
  db.close();
}

async function saveMemo(memo: MilpMemo): Promise<void> {
  // Only new, real solutions — null verdicts and already-persisted keys skip.
  const fresh: Array<[string, Map<string, number>]> = [];
  for (const [k, v] of memo) if (v !== null && !persisted.has(k)) fresh.push([k, v]);
  if (fresh.length === 0) return;
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      for (const [k, v] of fresh) {
        store.put({ v: [...v.entries()], t: ++saveSeq } satisfies MemoRow, k);
        persisted.add(k);
      }
      // FIFO cap: drop the oldest rows beyond MAX_ROWS (cache-only — evicted
      // models re-solve deterministically to the same answer next session).
      const countReq = store.count();
      countReq.onsuccess = () => {
        let excess = countReq.result - MAX_ROWS;
        if (excess <= 0) return;
        const cursorReq = store.index('t').openCursor();
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (!cursor || excess <= 0) return;
          persisted.delete(cursor.primaryKey as string);
          cursor.delete();
          excess--;
          cursor.continue();
        };
      };
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

let milpPromise: Promise<Solver | null> | null = null;
const memo: MilpMemo = new Map();

function getMilp(): Promise<Solver | null> {
  if (!milpPromise) {
    milpPromise = (async () => {
      try {
        // The IndexedDB memo read has no dependency on HiGHS — hydrate it in
        // parallel with the WASM fetch/compile instead of after it.
        const [highs] = await Promise.all([
          (async () => {
            const [{ default: loadHighs }, { default: wasmUrl }] = await Promise.all([
              import('highs'),
              import('highs/runtime?url'),
            ]);
            return loadHighs({ locateFile: () => wasmUrl });
          })(),
          loadMemo(memo),
        ]);
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
    if (kind === 'warmup') {
      // Prefetch the WASM + memo while the app is still booting; the reply is
      // informational (the client fires and forgets).
      await getMilp();
      self.postMessage({ id, type: 'result', ok: true, result: null } satisfies WorkerMessage);
      return;
    }
    const solver = kind === 'optimize' ? await getMilp() : null;
    reportProgress =
      kind === 'optimize'
        ? (done, total) => self.postMessage({ id, type: 'progress', done, total } satisfies WorkerMessage)
        : null;
    const r = assembleSchedule({ ...(input as Omit<AssembleInput, 'solver'>), solver: solver ?? undefined });
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
