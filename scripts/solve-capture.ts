/**
 * Capture full solver output (both engines) for a state JSON, for byte-level
 * diffing across optimization changes. Also reports timings, including a WARM
 * second MIP pass on the same solver instance (memo exercised).
 *
 *   npx ts-node scripts/solve-capture.ts <state.json> <outPrefix>
 */
import * as fs from 'fs';
import { solve } from '../src/solver';
import { createMilpSolver } from '../src/milp/milpSolver';
import { SolveInput } from '../src/types';
import { addDays, startOfISOWeek } from '../src/time';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const loadHighs = require('highs');

async function main() {
  const state = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const prefix = process.argv[3];
  const today = state.today;
  const end = addDays(startOfISOWeek(addDays(today, state.horizonDays ?? 365)), 6);
  const input: SolveInput = {
    config: state.config,
    intents: state.intents,
    modes: state.modes ?? [],
    existingCalendar: (state.frozen ?? [])
      .filter((f: { end: string }) => f.end > `${today}T00:00`)
      .map((f: { uid: string; subject: string; start: string; end: string }) => ({
        uid: f.uid,
        subject: f.subject,
        start: f.start,
        end: f.end,
      })),
    horizon: { start: startOfISOWeek(today), end },
    today,
  };

  let t = performance.now();
  const g = solve(input);
  const tGreedy = performance.now() - t;

  const highs = await loadHighs();
  const milp = createMilpSolver(highs);
  t = performance.now();
  const m = milp.solve(input);
  const tCold = performance.now() - t;
  t = performance.now();
  const m2 = milp.solve(input);
  const tWarm = performance.now() - t;

  const stable = (o: unknown) => JSON.stringify(o, null, 1);
  fs.writeFileSync(`${prefix}.greedy.json`, stable({ instances: g.instances, conflicts: g.conflicts, updates: g.updates }));
  fs.writeFileSync(`${prefix}.milp.json`, stable({ instances: m.instances, conflicts: m.conflicts, updates: m.updates }));
  const warmIdentical = JSON.stringify(m2.instances) === JSON.stringify(m.instances);
  console.log(
    `greedy=${tGreedy.toFixed(0)}ms cold-milp=${tCold.toFixed(0)}ms warm-milp=${tWarm.toFixed(0)}ms ` +
      `g:${g.instances.length}i/${g.conflicts.length}c m:${m.instances.length}i/${m.conflicts.length}c warm-identical=${warmIdentical}`
  );
}
main();
