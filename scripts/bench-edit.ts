/* How much of the memo survives a realistic edit? Cold-populate, then re-solve
 * after single-field edits on the SAME solver instance, counting memo-hit weeks. */
import * as fs from 'fs';
import { createMilpSolver } from '../src/milp/milpSolver';
import { Intent, SolveInput } from '../src/types';
import { addDays, startOfISOWeek } from '../src/time';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const loadHighs = require('highs');

async function main() {
  const state = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const today = state.today;
  const end = addDays(startOfISOWeek(addDays(today, 365)), 6);
  const base: SolveInput = {
    config: state.config,
    intents: state.intents,
    modes: [],
    existingCalendar: [],
    horizon: { start: startOfISOWeek(today), end },
    today,
  };
  let hits = 0;
  let solved = 0;
  const milp = createMilpSolver(await loadHighs(), {
    onWeek(_wk, info) {
      if (info.skipped) return;
      solved++;
      if (info.memo) hits++;
    },
  });
  const run = (label: string, intents: Intent[]) => {
    hits = 0; solved = 0;
    const t = performance.now();
    milp.solve({ ...base, intents });
    console.log(`${label}: ${(performance.now() - t).toFixed(0)}ms  weeks-touched=${solved} memo-hit-weeks=${hits}`);
  };
  const clone = () => JSON.parse(JSON.stringify(state.intents)) as Intent[];

  run('cold (populate)      ', clone());
  run('no-op re-solve       ', clone());

  const prio = clone();
  prio.find((i) => i.subject === 'Coding projects')!.priority = 55;
  run('priority 50->55      ', prio);

  const dur = clone();
  dur.find((i) => i.subject === 'Gym workout')!.duration = [60, 90];
  run('duration [75,90]->[60,90]', dur);

  const card = clone();
  const park = card.find((i) => i.subject === 'Park time')!;
  (park.cardinality as { days: { count: [number, number] } }).days.count = [2, 4];
  run('park count [3,4]->[2,4]  ', card);

  const added = clone();
  added.push({ subject: 'Guitar', mode: 'default', priority: 40, duration: [30, 45], window: { not_before: '18:00' }, cardinality: { period: { unit: 'week' }, days: { count: [2, 2] } }, id: 'guitar' });
  run('add small weekly intent  ', added);
}
main();
