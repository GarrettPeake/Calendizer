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
