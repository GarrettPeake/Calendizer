/**
 * Solve-time scaling vs intent count: solves growing prefixes of a state's
 * intents (then synthetic clones past the real count) over a fixed horizon and
 * reports cold MIP + greedy wall time per step.
 *
 *   npx ts-node scripts/bench-scaling.ts <state.json> [horizonDays]
 */
import * as fs from 'fs';
import { assembleSchedule } from '../src/schedule';
import { createMilpSolver } from '../src/milp/milpSolver';
import { createBubbleSolver } from '../src/bubble/bubbleSolver';
import { Intent } from '../src/types';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const loadHighs = require('highs');

async function main() {
  const state = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const horizonDays = Number(process.argv[3] ?? 91);
  const highs = await loadHighs();

  // Stable, structure-first order: blockers and daily anchors first so every
  // prefix is a plausible calendar, then the weekly contenders.
  const base: Intent[] = state.intents;
  const weekly = base.filter((i: Intent) => i.cardinality?.period?.unit === 'week');
  // Synthetic extension: clone weekly intents with shifted windows + new ids.
  const clones: Intent[] = [];
  for (let round = 1; round <= 2; round++) {
    for (const src of weekly) {
      const shift = (m: string | undefined, dh: number) => {
        if (typeof m !== 'string') return m;
        const [h, mm] = m.split(':').map(Number);
        return `${String(Math.max(0, Math.min(23, h - dh))).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
      };
      clones.push({
        ...src,
        id: `${src.id}-clone${round}`,
        subject: `${src.subject} c${round}`,
        window: {
          ...src.window,
          not_before: shift(src.window?.not_before as string | undefined, round),
          not_after: shift(src.window?.not_after as string | undefined, round),
        },
      });
    }
  }
  const all = [...base, ...clones];

  console.log(`n\tintents\tocc\tgreedy_ms\tbubble_ms\tbubble_conf\tmilp_ms\tmilp_conf`);
  for (let n = 2; n <= all.length; n += n < base.length ? 2 : 4) {
    const intents = all.slice(0, n);
    const input = {
      config: state.config,
      intents,
      modeRecords: state.modes ?? [],
      frozen: [],
      nowDT: state.nowDT,
      today: state.today,
      horizonDays,
    };
    let t = performance.now();
    const g = assembleSchedule({ ...input });
    const tGreedy = performance.now() - t;
    t = performance.now();
    const b = assembleSchedule({ ...input, solver: createBubbleSolver() });
    const tBubble = performance.now() - t;
    let tMilp = -1;
    let milpConf = -1;
    if (!process.env.SKIP_MILP) {
      t = performance.now();
      const m = assembleSchedule({ ...input, solver: createMilpSolver(highs) });
      tMilp = performance.now() - t;
      milpConf = m.conflicts.length;
    }
    console.log(
      `${n}\t${intents.map((i) => i.subject.slice(0, 4)).join(',').slice(0, 40)}\t${b.instances.length}\t${tGreedy.toFixed(0)}\t${tBubble.toFixed(0)}\t${b.conflicts.length}\t${tMilp.toFixed(0)}\t${milpConf}`
    );
  }
}
main();
