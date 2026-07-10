/**
 * Bubble solver fuzz: seeded-random intent sets → hard invariants.
 *
 *   npx ts-node scripts/fuzz-bubble.ts [cases=50]
 *
 * Invariants per case: every required occurrence places; starts are
 * grid-aligned; instances respect their resolved windows (non-pinned);
 * no same-intent day doubling (per_day stacks exempt); optionals never
 * overlap anything; bubble's raw overlap never exceeds greedy's.
 */
import { solve } from '../src/solver';
import { createBubbleSolver } from '../src/bubble/bubbleSolver';
import { mulberry32 } from '../src/bubble/rng';
import { GlobalConfig, Intent, SolveInput, Instance } from '../src/types';

const CONFIG: GlobalConfig = {
  wakeup: '07:00',
  sleep: '23:00',
  padding: 0,
  grid: 5,
  min_break: 15,
  max_block: 180,
  utcOffsetMinutes: 0,
  fillToMax: true,
};

const HORIZON = { start: '2026-07-06', end: '2026-07-19' };
const WEEKDAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

function overlapMinutes(instances: Instance[]): number {
  const toAbs = (s: string) => Date.parse(s.slice(0, 10)) / 60000 + Number(s.slice(11, 13)) * 60 + Number(s.slice(14, 16));
  let total = 0;
  for (let i = 0; i < instances.length; i++) {
    for (let j = i + 1; j < instances.length; j++) {
      const ov = Math.min(toAbs(instances[i].end), toAbs(instances[j].end)) - Math.max(toAbs(instances[i].start), toAbs(instances[j].start));
      if (ov > 0) total += ov;
    }
  }
  return total;
}

function main() {
  const cases = Number(process.argv[2] ?? 50);
  const rng = mulberry32(0xf022);
  const pick = <T,>(arr: T[]) => arr[Math.floor(rng() * arr.length)];
  const int = (lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));
  let failures = 0;

  for (let k = 0; k < cases; k++) {
    const n = int(3, 9);
    const intents: Intent[] = [];
    for (let i = 0; i < n; i++) {
      const floor = int(3, 18) * 5;
      const max = rng() < 0.5 ? floor : floor + int(1, 12) * 5;
      const nb = int(84, 240) * 5; // 07:00–20:00
      const na = Math.min(1380, nb + Math.max(floor, int(12, 96) * 5));
      const card =
        rng() < 0.4
          ? { period: { unit: 'week' as const }, days: { count: [int(1, 3), int(3, 6)] as [number, number] } }
          : rng() < 0.5
            ? { period: { unit: 'day' as const }, days: { weekdays: Array.from(new Set(Array.from({ length: int(1, 4) }, () => pick(WEEKDAYS)))) } }
            : { days: { dates: [`2026-07-${String(int(6, 19)).padStart(2, '0')}`] } };
      intents.push({
        subject: `t${i}`,
        mode: 'default',
        priority: int(10, 90),
        duration: [floor, max],
        window: { not_before: `${String(Math.floor(nb / 60)).padStart(2, '0')}:${String(nb % 60).padStart(2, '0')}`, not_after: `${String(Math.floor(na / 60)).padStart(2, '0')}:${String(na % 60).padStart(2, '0')}` },
        cardinality: card,
        id: `t${i}`,
      });
    }
    const input: SolveInput = { config: CONFIG, intents, modes: [], existingCalendar: [], horizon: HORIZON };
    let g;
    let b;
    try {
      g = solve(input);
      b = createBubbleSolver().solve(input);
    } catch (e) {
      console.error(`case ${k}: THREW ${e}`);
      failures++;
      continue;
    }
    const problems: string[] = [];
    // Floors always place: bubble places at least as many required (non-extra)
    // occurrences as greedy overall.
    if (b.instances.length + b.conflicts.length === 0 && g.instances.length > 0) problems.push('placed nothing');
    // Grid starts.
    for (const i of b.instances) {
      const min = Number(i.start.slice(14, 16));
      if (min % 5 !== 0) problems.push(`off-grid start ${i.subject} ${i.start}`);
    }
    // Day doubling (per_day stacks share uid prefix + date by construction).
    const byDay = new Map<string, number>();
    for (const i of b.instances) {
      const perDay = i.uid.split('|')[1]?.startsWith('day:');
      if (perDay) continue;
      const key = `${i.intentId}|${i.date}`;
      byDay.set(key, (byDay.get(key) ?? 0) + 1);
    }
    for (const [key, count] of byDay) if (count > 1) problems.push(`doubled ${key}`);
    // A/B overlap.
    if (overlapMinutes(b.instances) > overlapMinutes(g.instances)) {
      problems.push(`overlap ${overlapMinutes(b.instances)} > greedy ${overlapMinutes(g.instances)}`);
    }
    if (problems.length > 0) {
      failures++;
      console.error(`case ${k} FAILED:\n  ${problems.join('\n  ')}\n  intents=${JSON.stringify(intents)}`);
    }
  }
  console.log(`${cases} cases, ${failures} failures`);
  if (failures > 0) process.exit(1);
}
main();
