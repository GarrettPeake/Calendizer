/**
 * Oracle A/B: solve a state with bubble, the MIP, and greedy; report quality
 * proxies (doubles / conflicts / non-blocker overlap / sleep / total minutes)
 * and wall time for each.
 *
 *   npx ts-node scripts/bubble-vs-milp.ts <state.json> [horizonDays] [--skip-milp]
 */
import * as fs from 'fs';
import { assembleSchedule, AssembleInput } from '../src/schedule';
import { createMilpSolver } from '../src/milp/milpSolver';
import { createBubbleSolver } from '../src/bubble/bubbleSolver';
import { Instance } from '../src/types';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const loadHighs = require('highs');

function metrics(instances: Instance[], conflicts: unknown[], today: string) {
  const future = instances.filter((i) => i.date >= today);
  const byDay = new Map<string, number>();
  for (const i of future) {
    const k = `${i.intentId}|${i.date}`;
    byDay.set(k, (byDay.get(k) ?? 0) + 1);
  }
  let doubles = 0;
  for (const n of byDay.values()) if (n > 1) doubles += n - 1;
  const toAbs = (s: string) => Date.parse(s.slice(0, 10)) / 60000 + Number(s.slice(11, 13)) * 60 + Number(s.slice(14, 16));
  // Overlap among events that are neither blockers nor living inside one.
  const plain = future.filter((i) => !i.blocker && !(i.blockedBy && i.blockedBy.length));
  let ov = 0;
  for (let a = 0; a < plain.length; a++) {
    for (let b = a + 1; b < plain.length; b++) {
      const o = Math.min(toAbs(plain[a].end), toAbs(plain[b].end)) - Math.max(toAbs(plain[a].start), toAbs(plain[b].start));
      if (o > 0) ov += o;
    }
  }
  const sleep = future.filter((i) => i.placedDuringSleep).length;
  const total = future.reduce((s, i) => s + i.durationMin, 0);
  return { n: future.length, doubles, conflicts: conflicts.length, ov, sleep, total };
}

async function main() {
  const state = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const horizonDays = Number(process.argv[3] ?? 365);
  const skipMilp = process.argv.includes('--skip-milp');
  const base: Omit<AssembleInput, 'solver'> = {
    config: state.config,
    intents: state.intents,
    modeRecords: state.modes ?? [],
    frozen: state.frozen ?? [],
    nowDT: state.nowDT,
    today: state.today,
    horizonDays,
  };
  const run = (name: string, solver?: AssembleInput['solver']) => {
    const t = performance.now();
    const out = assembleSchedule({ ...base, solver });
    const ms = performance.now() - t;
    const m = metrics(out.instances, out.conflicts, state.today);
    console.log(
      `${name.padEnd(7)} ${ms.toFixed(0).padStart(7)}ms  n=${m.n} doubles=${m.doubles} conflicts=${m.conflicts} ` +
        `overlap=${m.ov} sleep=${m.sleep} totalMin=${m.total}`
    );
    return out;
  };
  run('greedy');
  run('bubble', createBubbleSolver());
  if (!skipMilp) {
    const highs = await loadHighs();
    run('milp', createMilpSolver(highs));
  }
}
main();
