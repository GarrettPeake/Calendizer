import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { solve } from '../solver';
import { createMilpSolver } from './milpSolver';
import { HighsInstance } from './stages';
import { GlobalConfig, Intent, SolveInput, Instance } from '../types';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const loadHighs: () => Promise<HighsInstance> = require('highs');

let highs: HighsInstance;
before(async () => {
  highs = await loadHighs();
});

const CONFIG: GlobalConfig = {
  wakeup: '07:00',
  sleep: '23:00',
  padding: 0,
  grid: 5,
  min_break: 15,
  max_block: 180,
  utcOffsetMinutes: 0,
};

function intent(subject: string, patch: Partial<Intent>): Intent {
  return {
    subject,
    mode: 'default',
    priority: 50,
    duration: [60, 60],
    window: {},
    cardinality: {},
    id: subject,
    ...patch,
  };
}

const HORIZON = { start: '2026-07-06', end: '2026-07-12' };

function inputOf(intents: Intent[], config: GlobalConfig = CONFIG): SolveInput {
  return { config, intents, modes: [], existingCalendar: [], horizon: HORIZON };
}

/** Raw pairwise overlap minutes across a set of instances. */
function overlapMinutes(instances: Instance[]): number {
  const toAbs = (s: string) => Date.parse(s.slice(0, 10)) / 60000 + Number(s.slice(11, 13)) * 60 + Number(s.slice(14, 16));
  let total = 0;
  for (let i = 0; i < instances.length; i++) {
    for (let j = i + 1; j < instances.length; j++) {
      const a = instances[i];
      const b = instances[j];
      const ov = Math.min(toAbs(a.end), toAbs(b.end)) - Math.max(toAbs(a.start), toAbs(b.start));
      if (ov > 0) total += ov;
    }
  }
  return total;
}

// The greedy repair blind spot: C's only slot is under A; A's only other slot
// is under B; B (overlap-free) never moves. The chain C@9 → A@10 → B@11 exists.
const CHAIN = [
  intent('A', { priority: 60, window: { not_before: '09:00', not_after: '11:00' }, cardinality: { days: { dates: ['2026-07-07'] } } }),
  intent('B', { priority: 50, window: { not_before: '09:00', not_after: '12:00' }, cardinality: { days: { dates: ['2026-07-07'] } } }),
  intent('C', { priority: 40, window: { not_before: '09:00', not_after: '10:00' }, cardinality: { days: { dates: ['2026-07-07'] } } }),
];

test('resolves the coordination chain greedy cannot (0 conflicts, exact optimum)', () => {
  const input = inputOf(CHAIN);
  const g = solve(input);
  assert.equal(g.conflicts.length, 1); // greedy is stuck — this is the point
  const m = createMilpSolver(highs).solve(input);
  assert.equal(m.conflicts.length, 0);
  const at = (s: string) => m.instances.find((i) => i.subject === s)!.start.slice(11);
  assert.deepEqual([at('C'), at('A'), at('B')], ['09:00', '10:00', '11:00']);
});

test('deterministic: repeated solves and permuted intent order agree exactly', () => {
  const milp = createMilpSolver(highs);
  const a = milp.solve(inputOf(CHAIN));
  const b = milp.solve(inputOf(CHAIN));
  const perm = createMilpSolver(highs).solve(inputOf([CHAIN[2], CHAIN[0], CHAIN[1]]));
  assert.deepEqual(a.instances, b.instances);
  assert.deepEqual(a.instances, perm.instances);
});

test('clean week: byte-identical to greedy (seed kept verbatim)', () => {
  const intents = [
    intent('yoga', { window: { not_before: '08:00', not_after: '10:00' }, cardinality: { period: { unit: 'day' } } }),
    intent('review', { window: { not_before: '14:00', not_after: '17:00' }, cardinality: { days: { dates: ['2026-07-08'] } } }),
  ];
  const input = inputOf(intents);
  const g = solve(input);
  const m = createMilpSolver(highs).solve(input);
  assert.deepEqual(m.instances, g.instances);
  assert.deepEqual(m.conflicts, g.conflicts);
  assert.deepEqual(m.updates, g.updates);
});

test('A/B property: milp never has more raw overlap than greedy', () => {
  // An oversubscribed afternoon: three 2h events into a 5h window plus a fixed
  // 1h meeting — some overlap is forced; milp must not exceed greedy's.
  const intents = [
    intent('a', { priority: 70, duration: [120, 120], window: { not_before: '12:00', not_after: '17:00' }, cardinality: { days: { dates: ['2026-07-09'] } } }),
    intent('b', { priority: 60, duration: [120, 120], window: { not_before: '12:00', not_after: '17:00' }, cardinality: { days: { dates: ['2026-07-09'] } } }),
    intent('c', { priority: 50, duration: [120, 120], window: { not_before: '12:00', not_after: '17:00' }, cardinality: { days: { dates: ['2026-07-09'] } } }),
  ];
  const input: SolveInput = {
    ...inputOf(intents),
    existingCalendar: [{ uid: 'x', subject: 'Meeting', start: '2026-07-09T13:00', end: '2026-07-09T14:00' }],
  };
  const g = solve(input);
  const m = createMilpSolver(highs).solve(input);
  assert.ok(overlapMinutes(m.instances) <= overlapMinutes(g.instances));
  assert.equal(m.instances.length, g.instances.length); // floors always place
});

test('optionals are never forced: fillToMax extras appear only in clean slots', () => {
  const cfg: GlobalConfig = { ...CONFIG, fillToMax: true };
  // Window fits exactly two clean occurrences per day; count wants up to 7/week.
  const intents = [
    intent('walk', {
      duration: [60, 60],
      window: { not_before: '09:00', not_after: '11:00' },
      cardinality: { period: { unit: 'week' }, days: { count: [2, 7] } },
    }),
    intent('block', {
      priority: 90,
      duration: [120, 120],
      window: { not_before: '09:00', not_after: '11:00' },
      cardinality: { period: { unit: 'day' }, days: { weekdays: ['WE', 'TH', 'FR', 'SA', 'SU'] } },
    }),
  ];
  const m = createMilpSolver(highs).solve(inputOf(intents, cfg));
  // Block occupies the whole window Wed–Sun; extras beyond the floor may only
  // appear where they are CLEAN — never as an overlap, never as a conflict.
  // (Exact count is greedy-spill-semantics territory; the contract is
  // cleanliness.)
  const walks = m.instances.filter((i) => i.subject === 'walk');
  assert.ok(walks.length >= 2 && walks.length <= 7);
  assert.ok(walks.every((w) => w.date < '2026-07-08')); // only Mon/Tue are free
  assert.equal(m.conflicts.length, 0);
  assert.equal(overlapMinutes(m.instances), 0);
});

test('same-intent occurrences never share a day (the "two Park times on Saturday" bug)', () => {
  const cfg: GlobalConfig = { ...CONFIG, wakeup: '08:00', sleep: '23:30', fillToMax: true, utcOffsetMinutes: -420 };
  // Work blocks weekdays; Park's floors spill onto the weekend where the
  // fillToMax extras were natively dated — greedy stacks two on Saturday.
  const intents = [
    intent('Work', {
      priority: 95,
      duration: [480, 480],
      window: { starts_at: '09:00' },
      cardinality: { period: { unit: 'day' }, days: { weekdays: ['MO', 'TU', 'WE', 'TH', 'FR'] } },
      id: 'work',
    }),
    intent('Park time', {
      priority: 55,
      duration: [75, 75],
      window: { not_before: '11:30', not_after: '17:00' },
      cardinality: { period: { unit: 'week' }, days: { count: [2, 4] } },
      id: 'park',
    }),
  ];
  const input = inputOf(intents, cfg);
  const g = solve(input);
  const daysOf = (out: { instances: Instance[] }) => out.instances.filter((i) => i.subject === 'Park time').map((i) => i.date);
  const gDays = daysOf(g);
  assert.ok(new Set(gDays).size < gDays.length, 'premise: greedy doubles a day'); // the gap being pinned
  const m = createMilpSolver(highs).solve(input);
  const mDays = daysOf(m);
  assert.equal(new Set(mDays).size, mDays.length, `milp doubled: ${mDays.join(',')}`);
  assert.ok(mDays.length >= 2); // floors always place
  assert.equal(m.conflicts.length, 0);
  assert.equal(overlapMinutes(m.instances), 0);
});

test('duration growth: milp fills toward max at least as well as greedy', () => {
  const cfg: GlobalConfig = { ...CONFIG, fillToMax: true };
  const intents = [
    intent('deep work', { priority: 80, duration: [60, 180], window: { not_before: '09:00', not_after: '13:00' }, cardinality: { days: { dates: ['2026-07-10'] } } }),
    intent('errand', { priority: 40, duration: [30, 60], window: { not_before: '09:00', not_after: '13:00' }, cardinality: { days: { dates: ['2026-07-10'] } } }),
  ];
  const input = inputOf(intents, cfg);
  const g = solve(input);
  const m = createMilpSolver(highs).solve(input);
  const total = (out: { instances: Instance[] }) => out.instances.reduce((s, i) => s + i.durationMin, 0);
  assert.ok(total(m) >= total(g));
  assert.equal(overlapMinutes(m.instances), 0);
});
