/**
 * Regression tests for occurrence uid uniqueness. A weekly/monthly `days.count`
 * intent used to give every day in a bucket the same uid (perDayIndex 0), which
 * collided — the temporal overlay then dropped a whole week's occurrences when
 * one was already frozen. Uids now key on a per-bucket occurrence sequence.
 *
 * Run with: npm run test:unit
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Intent } from './types';
import { expandIntent } from './expand';
import { dateRange } from './time';

const weekly = (over: Partial<Intent> = {}): Intent => ({
  subject: 'workout',
  mode: 'default',
  priority: 50,
  duration: [30, 30],
  window: {},
  cardinality: { period: { unit: 'week', interval: 1 }, days: { count: [4, 4] } },
  ...over,
});

const uids = (intent: Intent, start: string, end: string, fillToMax = false) =>
  expandIntent(intent, dateRange(start, end), [], fillToMax).map((s) => s.uid);

test('weekly days.count: every occurrence in a week has a distinct uid', () => {
  // A single ISO week (Mon 2026-06-29 .. Sun 2026-07-05), 4 per week.
  const u = uids(weekly(), '2026-06-29', '2026-07-05');
  assert.equal(u.length, 4);
  assert.equal(new Set(u).size, 4, 'uids must be unique within the week');
});

test('weekly days.count: uids are unique across multiple weeks too', () => {
  const u = uids(weekly(), '2026-06-29', '2026-07-19'); // three ISO weeks
  assert.equal(new Set(u).size, u.length);
});

test('weekly days.count with per_day stacking keeps all uids unique', () => {
  const u = uids(
    weekly({ cardinality: { period: { unit: 'week', interval: 1 }, days: { count: [2, 2] }, per_day: { count: [2, 2] } } }),
    '2026-06-29',
    '2026-07-05'
  );
  assert.equal(new Set(u).size, u.length);
});

test('a daily intent keeps its stable day-keyed uid', () => {
  const daily = weekly({ cardinality: { period: { unit: 'day', interval: 1 }, per_day: { count: [1, 1] } } });
  const u = uids(daily, '2026-06-29', '2026-06-30');
  assert.deepEqual(u, ['workout|day:2026-06-29|0', 'workout|day:2026-06-30|0']);
});

const biweeklySat = (anchor?: string): Intent => ({
  subject: 'groceries',
  mode: 'default',
  priority: 45,
  duration: [150, 150],
  window: { not_before: '08:00', not_after: '18:00' },
  cardinality: {
    period: { unit: 'week', interval: 2, ...(anchor ? { anchor } : {}) },
    days: { weekdays: ['SA'] },
  },
  id: 'groc',
});

test('interval grouping is anchored: a rolling horizon never shifts the cadence', () => {
  // The same intent expanded over horizons starting one week apart (the
  // retention window rolls weekly) must choose IDENTICAL dates on the overlap
  // — the prod "biweekly groceries drift" report of 2026-07-10.
  const a = expandIntent(biweeklySat(), dateRange('2026-06-29', '2026-08-30'), []).map((s) => s.date);
  const b = expandIntent(biweeklySat(), dateRange('2026-07-06', '2026-08-30'), []).map((s) => s.date);
  assert.deepEqual(a.filter((d) => d >= '2026-07-06'), b);
  for (let i = 1; i < b.length; i++) {
    assert.equal((Date.parse(b[i]) - Date.parse(b[i - 1])) / 86_400_000, 14, `cadence broke at ${b[i]}`);
  }
});

test('anchor sets the phase: tethering to the creation week flips parity', () => {
  const horizon = dateRange('2026-07-06', '2026-08-16');
  const even = expandIntent(biweeklySat('2026-07-06'), horizon, []).map((s) => s.date);
  const odd = expandIntent(biweeklySat('2026-07-13'), horizon, []).map((s) => s.date);
  assert.deepEqual(even, ['2026-07-11', '2026-07-25', '2026-08-08']);
  // W28 is the TAIL of the odd-anchored (W27,W28) group: a partial head group
  // at the horizon edge still yields its in-horizon occurrence (in production
  // the horizon head is ~90 days in the past, so these are always spent).
  assert.deepEqual(odd, ['2026-07-11', '2026-07-18', '2026-08-01', '2026-08-15']);
});

test('every-3-days grouping is anchored the same way', () => {
  const plant = (start: string, end: string) =>
    expandIntent(
      weekly({ cardinality: { period: { unit: 'day', interval: 3, anchor: '2026-07-06' } } }),
      dateRange(start, end),
      []
    ).map((s) => s.date);
  assert.deepEqual(plant('2026-07-06', '2026-07-20'), ['2026-07-06', '2026-07-09', '2026-07-12', '2026-07-15', '2026-07-18']);
  // A horizon starting on a later group boundary keeps the SAME boundaries.
  assert.deepEqual(plant('2026-07-09', '2026-07-20'), ['2026-07-09', '2026-07-12', '2026-07-15', '2026-07-18']);
});
