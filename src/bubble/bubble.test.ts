import { test } from 'node:test';
import assert from 'node:assert/strict';
import { solve } from '../solver';
import { createBubbleSolver } from './bubbleSolver';
import { GlobalConfig, Intent, SolveInput, Instance } from '../types';

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

const CHAIN = [
  intent('A', { priority: 60, window: { not_before: '09:00', not_after: '11:00' }, cardinality: { days: { dates: ['2026-07-07'] } } }),
  intent('B', { priority: 50, window: { not_before: '09:00', not_after: '12:00' }, cardinality: { days: { dates: ['2026-07-07'] } } }),
  intent('C', { priority: 40, window: { not_before: '09:00', not_after: '10:00' }, cardinality: { days: { dates: ['2026-07-07'] } } }),
];

test('resolves the coordination chain greedy cannot (0 conflicts)', () => {
  const input = inputOf(CHAIN);
  const g = solve(input);
  assert.equal(g.conflicts.length, 1); // greedy is stuck — this is the point
  const m = createBubbleSolver().solve(input);
  assert.equal(m.conflicts.length, 0);
  const at = (s: string) => m.instances.find((i) => i.subject === s)!.start.slice(11);
  assert.deepEqual([at('C'), at('A'), at('B')], ['09:00', '10:00', '11:00']);
});

test('deterministic: repeated solves and permuted intent order agree exactly', () => {
  const bubble = createBubbleSolver();
  const a = bubble.solve(inputOf(CHAIN));
  const b = bubble.solve(inputOf(CHAIN));
  const perm = createBubbleSolver().solve(inputOf([CHAIN[2], CHAIN[0], CHAIN[1]]));
  assert.deepEqual(a.instances, b.instances);
  assert.deepEqual(a.instances, perm.instances);
});

test('A/B property: bubble never has more raw overlap than greedy', () => {
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
  const m = createBubbleSolver().solve(input);
  assert.ok(overlapMinutes(m.instances) <= overlapMinutes(g.instances));
  assert.equal(m.instances.length, g.instances.length); // floors always place
});

test('same-intent occurrences never share a day (the "two Park times" shapes)', () => {
  const cfg: GlobalConfig = { ...CONFIG, wakeup: '08:00', sleep: '23:30', fillToMax: true, utcOffsetMinutes: -420 };
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
  const m = createBubbleSolver().solve(inputOf(intents, cfg));
  const days = m.instances.filter((i) => i.subject === 'Park time').map((i) => i.date);
  assert.equal(new Set(days).size, days.length, `doubled: ${days.join(',')}`);
  assert.ok(days.length >= 2);
  assert.equal(m.conflicts.length, 0);
  assert.equal(overlapMinutes(m.instances), 0);
});

test('prod shape: drop-then-revive never doubles (lunch-split weekend window)', () => {
  const cfg: GlobalConfig = { ...CONFIG, wakeup: '08:00', sleep: '23:30', fillToMax: true, utcOffsetMinutes: -420 };
  const intents = [
    intent('Work', {
      priority: 50,
      duration: [510, 510],
      window: { starts_at: '09:00' },
      cardinality: { period: { unit: 'day' }, days: { weekdays: ['MO', 'TU', 'WE', 'TH', 'FR'] } },
      id: 'work',
    }),
    intent('lunch', {
      duration: [60, 60],
      window: { not_before: '12:00', not_after: '13:00' },
      cardinality: { period: { unit: 'day' }, per_day: { count: [1, 1] } },
      id: 'lunch',
    }),
    intent('Park time', {
      priority: 45,
      duration: [45, 76],
      window: { not_before: '11:30', not_after: '15:00' },
      cardinality: { period: { unit: 'week' }, days: { count: [1, 3] } },
      id: 'park',
    }),
  ];
  const m = createBubbleSolver().solve(inputOf(intents, cfg));
  const parks = m.instances.filter((i) => i.subject === 'Park time');
  const days = parks.map((i) => i.date);
  assert.equal(new Set(days).size, days.length, `doubled: ${days.join(',')}`);
  assert.ok(parks.length >= 1);
  assert.equal(overlapMinutes(m.instances.filter((i) => i.subject !== 'lunch')), 0);
});

test('optionals are never forced: extras appear only in clean slots', () => {
  const cfg: GlobalConfig = { ...CONFIG, fillToMax: true };
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
  const m = createBubbleSolver().solve(inputOf(intents, cfg));
  const walks = m.instances.filter((i) => i.subject === 'walk');
  assert.ok(walks.length >= 2 && walks.length <= 7);
  assert.ok(walks.every((w) => w.date < '2026-07-08')); // only Mon/Tue are free
  assert.equal(m.conflicts.length, 0);
  assert.equal(overlapMinutes(m.instances), 0);
});

test('duration growth: bubble fills toward max at least as well as greedy', () => {
  const cfg: GlobalConfig = { ...CONFIG, fillToMax: true };
  const intents = [
    intent('deep work', { priority: 80, duration: [60, 180], window: { not_before: '09:00', not_after: '13:00' }, cardinality: { days: { dates: ['2026-07-10'] } } }),
    intent('errand', { priority: 40, duration: [30, 60], window: { not_before: '09:00', not_after: '13:00' }, cardinality: { days: { dates: ['2026-07-10'] } } }),
  ];
  const input = inputOf(intents, cfg);
  const g = solve(input);
  const m = createBubbleSolver().solve(input);
  const total = (out: { instances: Instance[] }) => out.instances.reduce((s, i) => s + i.durationMin, 0);
  assert.ok(total(m) >= total(g));
  assert.equal(overlapMinutes(m.instances), 0);
});

test('templateHint anchors an unchanged re-solve to the published calendar', () => {
  const cfg: GlobalConfig = { ...CONFIG, fillToMax: true };
  const intents = [
    intent('yoga', { duration: [45, 90], window: { not_before: '08:00', not_after: '12:00' }, cardinality: { period: { unit: 'week' }, days: { count: [3, 5] } } }),
    intent('review', { duration: [30, 60], window: { not_before: '08:00', not_after: '12:00' }, cardinality: { period: { unit: 'week' }, days: { count: [2, 4] } } }),
  ];
  const first = createBubbleSolver().solve(inputOf(intents, cfg));
  const hint = first.instances.map((i) => ({ uid: i.uid, date: i.date, start: i.start }));
  const second = createBubbleSolver().solve({ ...inputOf(intents, cfg), templateHint: hint });
  assert.deepEqual(second.instances, first.instances);
});

test('ends_at pin grows backward from its anchored end', () => {
  const cfg: GlobalConfig = { ...CONFIG, fillToMax: true };
  const intents = [
    intent('wind down', { duration: [30, 90], window: { not_before: '18:00', ends_at: '22:00' }, cardinality: { days: { dates: ['2026-07-08'] } } }),
  ];
  const m = createBubbleSolver().solve(inputOf(intents, cfg));
  const w = m.instances.find((i) => i.subject === 'wind down')!;
  assert.equal(w.end.slice(11), '22:00');
  assert.equal(w.durationMin, 90);
});

test('a pinned-event pocket never starves a flexible dinner to its floor (weekend squish)', () => {
  // Prod shape (report 2026-07-10): a packed weekend day where the only slot
  // "left over" for dinner was the 30' pocket between the pinned sunset and
  // dinner's 21:00 window end. Raw weighted minutes PREFER parking dinner in
  // the pocket (nobody else can use it); the concave utility objective must
  // instead give dinner a fair share of the day's shared slack.
  const cfg: GlobalConfig = { ...CONFIG, wakeup: '08:00', sleep: '23:30', fillToMax: true, utcOffsetMinutes: -420 };
  const intents = [
    intent('Getting ready', { priority: 30, duration: [60, 60], window: { starts_at: '08:00' }, cardinality: { period: { unit: 'day' }, per_day: { count: [1, 1] } } }),
    intent('Gym workout', { duration: [75, 90], window: { not_before: '07:00', not_after: '23:00' }, cardinality: { period: { unit: 'day' }, per_day: { count: [1, 1] } } }),
    intent('Coding projects', { duration: [30, 90], window: { not_before: '10:00' }, cardinality: { period: { unit: 'day' }, per_day: { count: [1, 1] } } }),
    intent('lunch', { duration: [60, 60], window: { not_before: '12:00', not_after: '13:00' }, cardinality: { period: { unit: 'day' }, per_day: { count: [1, 1] } } }),
    intent('Cyberpunk 2077', { priority: 45, duration: [180, 180], window: {}, cardinality: { period: { unit: 'day' }, per_day: { count: [1, 1] } } }),
    intent('Pottery', { priority: 45, duration: [60, 180], window: { not_before: '11:00', not_after: '21:00' }, cardinality: { period: { unit: 'day' }, per_day: { count: [1, 1] } } }),
    intent('Watch sunset', { duration: [46, 60], window: { starts_at: '19:44' }, cardinality: { period: { unit: 'day' }, per_day: { count: [1, 1] } } }),
    intent('Dinner', { priority: 45, duration: [30, 90], window: { not_before: '17:30', not_after: '21:00' }, cardinality: { period: { unit: 'day' }, per_day: { count: [1, 1] } } }),
  ];
  const m = createBubbleSolver().solve({ config: cfg, intents, modes: [], existingCalendar: [], horizon: { start: '2026-07-08', end: '2026-07-08' } });
  const dinner = m.instances.find((i) => i.subject === 'Dinner')!;
  assert.ok(dinner.durationMin >= 55, `dinner starved: ${dinner.durationMin}' at ${dinner.start.slice(11)}`);
  assert.equal(overlapMinutes(m.instances), 0);
});
