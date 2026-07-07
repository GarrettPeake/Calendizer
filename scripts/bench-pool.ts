/**
 * Real-parallelism benchmark for the speculative pool: N worker_threads each
 * pre-solve a shard of phase-A models; the main thread merges their memo
 * entries and runs the normal sequential solve, which then mostly memo-hits.
 *
 *   npx ts-node scripts/bench-pool.ts <state.json> [poolSize]
 *
 * Reports wall-clock vs the sequential baseline and verifies the pooled
 * output is byte-identical to a fresh sequential solve.
 */
import * as fs from 'fs';
import * as path from 'path';
import { Worker } from 'worker_threads';
import { createMilpSolver, MilpMemo } from '../src/milp/milpSolver';
import { SolveInput } from '../src/types';
import { addDays, startOfISOWeek } from '../src/time';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const loadHighs = require('highs');

const WORKER_JS = `
const { parentPort, workerData } = require('worker_threads');
require('ts-node/register/transpile-only');
const { speculatePhaseA } = require(workerData.solverPath);
const loadHighs = require('highs');
loadHighs().then((highs) => {
  const entries = speculatePhaseA(highs, workerData.input, workerData.shardIndex, workerData.shardCount);
  parentPort.postMessage(entries.map(([k, v]) => [k, v === null ? null : [...v.entries()]]));
});
`;

async function main() {
  const state = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const poolSize = Number(process.argv[3] ?? 6);
  const today = state.today;
  const end = addDays(startOfISOWeek(addDays(today, 365)), 6);
  const input: SolveInput = {
    config: state.config,
    intents: state.intents,
    modes: state.modes ?? [],
    existingCalendar: [],
    horizon: { start: startOfISOWeek(today), end },
    today,
  };

  const highs = await loadHighs();

  // --- Pooled run: spawn shards, merge entries, then sequential solve. ---
  const t0 = performance.now();
  const memo: MilpMemo = new Map();
  const shards = await Promise.all(
    Array.from({ length: poolSize }, (_, i) => {
      return new Promise<Array<[string, Array<[string, number]> | null]>>((resolve, reject) => {
        const w = new Worker(WORKER_JS, {
          eval: true,
          workerData: {
            input,
            shardIndex: i,
            shardCount: poolSize,
            solverPath: path.resolve(__dirname, '../src/milp/milpSolver.ts'),
          },
        });
        w.once('message', (m) => resolve(m));
        w.once('error', reject);
      });
    })
  );
  const tPool = performance.now() - t0;
  for (const entries of shards) for (const [k, v] of entries) memo.set(k, v === null ? null : new Map(v));

  let hits = 0;
  let solved = 0;
  const pooled = createMilpSolver(highs, {
    onWeek(_wk, info) {
      if (!info.skipped) {
        solved++;
        if (info.memo) hits++;
      }
    },
  }, memo).solve(input);
  const tTotal = performance.now() - t0;

  // --- Sequential baseline for identity + speed comparison. ---
  const t1 = performance.now();
  const fresh = createMilpSolver(highs).solve(input);
  const tSeq = performance.now() - t1;

  const identical = JSON.stringify(pooled) === JSON.stringify(fresh);
  console.log(
    `pool=${poolSize}: speculation=${(tPool / 1000).toFixed(1)}s total=${(tTotal / 1000).toFixed(1)}s ` +
      `(sequential baseline=${(tSeq / 1000).toFixed(1)}s, ${(tSeq / tTotal).toFixed(1)}x) ` +
      `weeks=${solved} memo-hits=${hits} identical=${identical}`
  );
  if (!identical) process.exit(1);
}
main();
