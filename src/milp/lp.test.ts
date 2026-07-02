import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildWeekModel, WeekOccurrence } from './lp';
import { Item } from '../solver';
import { GlobalConfig, Intent } from '../types';

const CONFIG: GlobalConfig = {
  wakeup: '07:00',
  sleep: '23:00',
  padding: 0,
  grid: 5,
  min_break: 15,
  max_block: 180,
  utcOffsetMinutes: 0,
};

function makeItem(intent: Partial<Intent> & { subject: string }, slotPatch: Partial<Item['slot']> = {}, patch: Partial<Item> = {}): Item {
  const full: Intent = {
    subject: intent.subject,
    mode: 'default',
    priority: intent.priority ?? 50,
    duration: intent.duration ?? [60, 60],
    window: intent.window ?? {},
    cardinality: intent.cardinality ?? {},
    id: intent.id ?? intent.subject,
  };
  return {
    intent: full,
    slot: {
      intentId: full.id!,
      subject: full.subject,
      date: '2026-07-07',
      bucketKey: 'week:2026-W28',
      perDayIndex: 0,
      perDayCount: 1,
      uid: `${full.id}|week:2026-W28|0`,
      flexibleDay: false,
      ...slotPatch,
    },
    pinned: false,
    endPinned: false,
    slack: 1,
    ...patch,
  };
}

function occOf(item: Item, days?: string[]): WeekOccurrence {
  return { item, days: days ?? [item.slot.date], seed: null };
}

test('golden: single fixed-day occurrence produces the expected minimal model', () => {
  const item = makeItem({ subject: 'walk', duration: [60, 60], window: { not_before: '09:00', not_after: '19:00' } });
  const model = buildWeekModel({ occ: [occOf(item)], obstacles: [], config: CONFIG, habit: new Map(), phase: 'day' });

  // The [09:00,19:00] window admits no sleep intrusion → no m var, no sleep stage.
  assert.deepEqual(model.constraints, [
    'grid0: + 1 s0 - 5 g0 = 0',
    'whi0: + 1 s0 + 1 d0 <= 1140',
    'dvA0: + 1 dev0 - 1 s0 >= -540',
    'dvB0: + 1 dev0 + 1 s0 >= 540',
  ]);
  assert.deepEqual(model.bounds, ['0 <= g0 <= 576', '540 <= s0 <= 1140', '60 <= d0 <= 60', '0 <= dev0 <= 2880']);
  assert.deepEqual(model.generals, ['g0', 's0', 'd0']);
  assert.deepEqual(model.binaries, []);
  assert.deepEqual(model.stages.map((s) => s.name), ['earliness']);
  assert.equal(model.decode[0].fixedDate, '2026-07-07');
});

test('pair on one day: tight z big-M, integer coefficients, ov bound from geometry', () => {
  const a = makeItem({ subject: 'a', priority: 60, duration: [60, 60], window: { not_before: '09:00', not_after: '11:00' } });
  const b = makeItem({ subject: 'b', priority: 40, duration: [45, 45], window: { not_before: '09:00', not_after: '12:00' } });
  const model = buildWeekModel({ occ: [occOf(a), occOf(b)], obstacles: [], config: CONFIG, habit: new Map(), phase: 'day' });

  // Both orders feasible → z binary; ov bounded by window geometry, not 2880.
  assert.ok(model.binaries.includes('z0_1'));
  const ovBound = model.bounds.find((l) => l.includes('ov0_1'));
  assert.equal(ovBound, '0 <= ov0_1 <= 180'); // max(na_b − nb_a, na_a − nb_b) = max(180, 120) = 180
  const stage = model.stages.find((s) => s.name === 'overlap')!;
  assert.equal(stage.terms.get('ov0_1'), 60 + 40 + 2);
  for (const [, coeff] of stage.terms) assert.ok(Number.isInteger(coeff));
});

test('forced order: morning window entirely before evening window emits no pair at all', () => {
  const am = makeItem({ subject: 'am', window: { not_before: '08:00', not_after: '10:00' } });
  const pm = makeItem({ subject: 'pm', window: { not_before: '18:00', not_after: '20:00' } });
  const model = buildWeekModel({ occ: [occOf(am), occOf(pm)], obstacles: [], config: CONFIG, habit: new Map(), phase: 'day' });
  assert.equal(model.constraints.filter((c) => c.startsWith('po')).length, 0);
  assert.ok(!model.binaries.includes('z0_1'));
});

test('interacting pair always gets BOTH direction rows + z (elision is unsound under forced overlap)', () => {
  // a [9,11] 60m, b [10,15] 60m: only a-before-b can be overlap-free, but the
  // b-before-a direction must STILL be modeled — otherwise a forced-overlap
  // arrangement sitting in that direction gets a mispriced (inflated) ov,
  // which can make a genuinely worse schedule look better.
  const a = makeItem({ subject: 'a', duration: [60, 60], window: { not_before: '09:00', not_after: '11:00' } });
  const b = makeItem({ subject: 'b', duration: [60, 60], window: { not_before: '10:00', not_after: '15:00' } });
  const model = buildWeekModel({ occ: [occOf(a), occOf(b)], obstacles: [], config: CONFIG, habit: new Map(), phase: 'day' });
  assert.ok(model.binaries.includes('z0_1'));
  assert.equal(model.constraints.filter((c) => c.startsWith('poA0_1')).length, 1);
  assert.equal(model.constraints.filter((c) => c.startsWith('poB0_1')).length, 1);
});

test('pinned starts_at: fixed s bounds, no grid row, growth capped by window and sleep', () => {
  const item = makeItem(
    { subject: 'routine', duration: [30, 120], window: { starts_at: '22:30' } },
    {},
    { pinned: true, endPinned: false }
  );
  const cfg = { ...CONFIG, fillToMax: true };
  const model = buildWeekModel({ occ: [occOf(item)], obstacles: [], config: cfg, habit: new Map(), phase: 'day' });
  assert.ok(model.bounds.includes('1350 <= s0 <= 1350'));
  // growth capped at sleep (23:00): dHi = 1380 − 1350 = 30 (== floor).
  assert.ok(model.bounds.includes('30 <= d0 <= 30'));
  assert.equal(model.constraints.filter((c) => c.startsWith('grid')).length, 0);
});

test('ends_at pin: endpin row and backward growth capped by not_before', () => {
  const item = makeItem(
    { subject: 'wind-down', duration: [30, 90], window: { ends_at: '23:00', not_before: '22:00' } },
    {},
    { pinned: true, endPinned: true }
  );
  const cfg = { ...CONFIG, fillToMax: true };
  const model = buildWeekModel({ occ: [occOf(item)], obstacles: [], config: cfg, habit: new Map(), phase: 'day' });
  assert.ok(model.constraints.includes('endpin0: + 1 s0 + 1 d0 = 1380'));
  // Backward growth to not_before 22:00 → dHi = 60.
  assert.ok(model.bounds.includes('30 <= d0 <= 60'));
});

test('optional occurrence: <= day row, gated duration, negative optimization terms, ideal', () => {
  const item = makeItem(
    { subject: 'extra', priority: 30, duration: [45, 60], window: { not_before: '09:00', not_after: '18:00' } },
    { optional: true, flexibleDay: true, bucketDates: ['2026-07-07', '2026-07-08'] }
  );
  const cfg = { ...CONFIG, fillToMax: true };
  const model = buildWeekModel({
    occ: [occOf(item, ['2026-07-07', '2026-07-08'])],
    obstacles: [],
    config: cfg,
    habit: new Map(),
    phase: 'week',
  });
  assert.ok(model.constraints.includes('day0: + 1 a0_0 + 1 a0_1 <= 1'));
  assert.ok(model.constraints.some((c) => c.startsWith('dfl0:')));
  assert.ok(model.constraints.some((c) => c.startsWith('dfh0:')));
  const opt = model.stages.find((s) => s.name === 'optionals')!;
  assert.equal(opt.terms.get('a0_0'), -31);
  assert.equal(opt.ideal, -31); // one placement's worth

  // In the day (packing) phase, the same occurrence enters as forced-required
  // and contributes its duration reach to the durations ideal.
  const dayModel = buildWeekModel({
    occ: [{ ...occOf(item, ['2026-07-07']), forceRequired: true }],
    obstacles: [],
    config: cfg,
    habit: new Map(),
    phase: 'day',
  });
  const dur = dayModel.stages.find((s) => s.name === 'durations')!;
  assert.equal(dur.ideal, -31 * 60);
});

test('day-exclusivity: a mover may not join a day with a fixed native of the same intent', () => {
  const nativeItem = makeItem({ subject: 'gym', id: 'gym' }, { date: '2026-07-08', uid: 'gym|w|0' });
  const moverItem = makeItem(
    { subject: 'gym', id: 'gym' },
    { date: '2026-07-10', uid: 'gym|w|1', flexibleDay: true, bucketDates: ['2026-07-08', '2026-07-10'] }
  );
  const model = buildWeekModel({
    occ: [occOf(nativeItem), occOf(moverItem, ['2026-07-08', '2026-07-10'])],
    obstacles: [],
    config: CONFIG,
    habit: new Map(),
    phase: 'week',
  });
  // Native is fixed-present on 07-08 (a constant resident) → the mover joining
  // that day must pay the day-doubling slack: Σ movers − xv ≤ 1 − fixed = 0.
  // The daydouble tier outranks EVERYTHING (overlap included): never double —
  // if the floor doesn't fit the clean days, surface the overlap conflict.
  assert.ok(model.constraints.some((c) => c.startsWith('xd_gym_20260708') && c.includes('- 1 xv_gym_') && c.endsWith('<= 0')));
  const names = model.stages.map((s) => s.name);
  const dbl = model.stages.find((s) => s.name === 'daydouble')!;
  assert.equal(dbl.ideal, 0);
  assert.ok(names.indexOf('daydouble') < names.indexOf('overlap'));
});

test('habit: |s − h| rows appear only with a target; gated for optionals', () => {
  const item = makeItem({ subject: 'walk', window: { not_before: '09:00', not_after: '19:00' } });
  const habit = new Map([['walk|0', 600]]);
  const model = buildWeekModel({ occ: [occOf(item)], obstacles: [], config: CONFIG, habit, phase: 'day' });
  assert.ok(model.constraints.includes('haA0: + 1 hab0 - 1 s0 >= -600'));
  assert.ok(model.constraints.includes('haB0: + 1 hab0 + 1 s0 >= 600'));
  assert.ok(model.stages.some((s) => s.name === 'habit'));
});

test('obstacle: tight bounds and both directions when the window strides it', () => {
  const item = makeItem({ subject: 'work', duration: [60, 60], window: { not_before: '09:00', not_after: '17:00' } });
  const model = buildWeekModel({
    occ: [occOf(item)],
    obstacles: [{ date: '2026-07-07', startMin: 720, endMin: 780, label: 'Standup' }],
    config: CONFIG,
    habit: new Map(),
    phase: 'day',
  });
  assert.ok(model.binaries.includes('zb0_0'));
  assert.ok(model.constraints.some((c) => c.startsWith('boA0_0')));
  assert.ok(model.constraints.some((c) => c.startsWith('boB0_0')));
  const bound = model.bounds.find((l) => l.includes('ovb0_0'));
  // zmA = na − S = 1020−720 = 300; zmB = E − nb = 780−540 = 240 → max 300.
  assert.equal(bound, '0 <= ovb0_0 <= 300');
});
