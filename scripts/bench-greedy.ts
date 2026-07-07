/* Ad-hoc phase timing of the greedy path (not shipped; used for latency audit). */
import * as fs from 'fs';
import { constructGreedy, repair, distributeDurations, assembleOutput, Construction } from '../src/solver';
import { assembleSchedule } from '../src/schedule';
import { SolveInput } from '../src/types';
import { addDays, startOfISOWeek } from '../src/time';

const state = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
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

for (let round = 0; round < 3; round++) {
  let t = performance.now();
  const c: Construction = constructGreedy(input);
  const tConstruct = performance.now() - t;

  t = performance.now();
  repair(c.placements, c.fixedOccupied, input.config, c.origin);
  const tRepair = performance.now() - t;

  t = performance.now();
  if (input.config.fillToMax) distributeDurations(c.placements, c.fixedOccupied, input.config, c.origin);
  const tDist = performance.now() - t;

  t = performance.now();
  const out = assembleOutput(c, input);
  const tAssemble = performance.now() - t;

  console.log(
    `round ${round}: construct=${tConstruct.toFixed(0)}ms repair=${tRepair.toFixed(0)}ms distribute=${tDist.toFixed(0)}ms assemble=${tAssemble.toFixed(0)}ms placements=${c.placements.length} conflicts=${out.conflicts.length}`
  );
}
