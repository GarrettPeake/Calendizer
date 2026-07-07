/**
 * Reproduce a bug-report state through the exact client pipeline
 * (assembleSchedule + MIP), printing any same-intent same-day doublings.
 *
 *   npx ts-node scripts/repro-bug.ts <state.json> [horizonDays]
 */
import * as fs from 'fs';
import { assembleSchedule } from '../src/schedule';
import { createMilpSolver } from '../src/milp/milpSolver';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const loadHighs = require('highs');

async function main() {
  const state = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const horizonDays = Number(process.argv[3] ?? 365);
  const highs = await loadHighs();
  const out = assembleSchedule({
    config: state.config,
    intents: state.intents,
    modeRecords: state.modes ?? [],
    frozen: state.frozen ?? [],
    nowDT: state.nowDT,
    today: state.today,
    horizonDays,
    solver: createMilpSolver(highs),
  });
  const byDay = new Map<string, string[]>();
  for (const i of out.instances) {
    const k = `${i.intentId}|${i.date}`;
    byDay.set(k, [...(byDay.get(k) ?? []), `${i.subject} ${i.start.slice(11)}-${i.end.slice(11)} [${i.uid}]`]);
  }
  let doubles = 0;
  for (const [k, v] of byDay) {
    if (v.length > 1 && !k.startsWith('35a7c88e') /* per_day intents may stack */) {
      // per_day cardinality legitimately stacks; report everything, caller judges
      console.log(`DOUBLE ${k}:`);
      for (const s of v) console.log(`  ${s}`);
      doubles++;
    }
  }
  const sleepy = out.instances.filter((i) => i.placedDuringSleep && i.date >= state.today);
  console.log(`${out.instances.length} instances, ${out.conflicts.length} conflicts, doubles=${doubles}, futureSleep=${sleepy.length}`);
  for (const s of sleepy.slice(0, 5)) console.log(`  SLEEP ${s.date} ${s.start.slice(11)}-${s.end.slice(11)} ${s.subject}`);
  const park = out.instances.filter((i) => i.subject === 'Park time' && i.date >= '2026-07-06' && i.date <= '2026-07-12');
  console.log('Park W28:', park.map((i) => `${i.date} ${i.start.slice(11)}-${i.end.slice(11)} (${i.uid.split('|').slice(1).join('|')})`));
}
main();
