/**
 * Greedy-engine unit tests. Run with:
 *   node --test --require ts-node/register src/solver.test.ts   (npm run test:unit)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { constructGreedy, isInSleep, trimBySleep } from './solver';
import { GlobalConfig, Intent, SolveInput } from './types';

const config: GlobalConfig = {
  wakeup: '07:00',
  sleep: '23:00',
  padding: 0,
  grid: 5,
  min_break: 15,
  max_block: 180,
  utcOffsetMinutes: 0,
};

const weekly = (count: [number, number]): Intent => ({
  id: 'park',
  subject: 'Park time',
  mode: 'default',
  priority: 50,
  duration: [60, 60],
  window: { not_before: '09:00', not_after: '17:00' },
  cardinality: { period: { unit: 'week', interval: 1 }, days: { count } },
});

const input = (over: Partial<SolveInput> = {}): SolveInput => ({
  config,
  intents: [weekly([2, 2])],
  horizon: { start: '2026-07-04', end: '2026-07-05' }, // Sat + Sun only
  ...over,
});

// The week-away report (ead7a279): with most of the week gone, every sibling
// spilled onto the same remaining day and the chosen-day free pass let them
// stack — two Park times back-to-back on Saturday. Day-exclusivity is a hard
// gate now: an occurrence with no free day left is DROPPED with a floor-unmet
// conflict, never doubled.
test('greedy never places two same-intent occurrences on one day (pigeonhole drops instead)', () => {
  // A same-subject resident (frozen, in-progress) already owns Saturday.
  const c = constructGreedy(
    input({
      existingCalendar: [
        { uid: 'frozen-park', subject: 'Park time', start: '2026-07-04T10:00', end: '2026-07-04T11:00' },
      ],
    })
  );
  const parks = c.placements.filter((p) => p.intent.id === 'park');
  // One occurrence fits (Sunday); the other has no double-free day left.
  assert.deepEqual(parks.map((p) => p.date), ['2026-07-05']);
  const unmet = c.conflicts.filter((k) => k.kind === 'floor-unmet');
  assert.equal(unmet.length, 1);
  assert.match(unmet[0].message, /Park time/);
});

test('greedy pigeonhole with every day occupied drops all excess occurrences', () => {
  const c = constructGreedy(
    input({
      existingCalendar: [
        { uid: 'f1', subject: 'Park time', start: '2026-07-04T10:00', end: '2026-07-04T11:00' },
        { uid: 'f2', subject: 'Park time', start: '2026-07-05T10:00', end: '2026-07-05T11:00' },
      ],
    })
  );
  assert.equal(c.placements.filter((p) => p.intent.id === 'park').length, 0);
  assert.equal(c.conflicts.filter((k) => k.kind === 'floor-unmet').length, 2);
});

// Report 2ada1b2a: sleep "00:00" (bedtime at midnight) made raw sleepStart (0)
// sit below wakeup, so isInSleep flagged the WHOLE day and trimBySleep always
// yielded — sleep avoidance silently disabled, dinner placed at 00:00.
test('a midnight bedtime protects [00:00, wakeup) and nothing else', () => {
  const cfg: GlobalConfig = { ...config, wakeup: '06:45', sleep: '00:00' };
  const d = '2026-07-20';
  assert.equal(isInSleep(0, 30, d, cfg), true); // inside the morning blackout
  assert.equal(isInSleep(405, 30, d, cfg), false); // at wakeup
  assert.equal(isInSleep(1410, 30, d, cfg), false); // ends exactly at midnight
  assert.deepEqual(trimBySleep(0, 1410, 30, d, cfg), [405, 1410]);
});

test('an after-midnight bedtime allows evening spillover until then', () => {
  const cfg: GlobalConfig = { ...config, wakeup: '06:45', sleep: '01:00' };
  const d = '2026-07-20';
  assert.equal(isInSleep(1440, 60, d, cfg), false); // 00:00-01:00 next day: awake
  assert.equal(isInSleep(1450, 60, d, cfg), true); // runs past 01:00
  assert.deepEqual(trimBySleep(0, 1470, 30, d, cfg), [405, 1470]);
});

test('per_day stacks still share their day', () => {
  const stacked: Intent = {
    id: 'reading',
    subject: 'Reading',
    mode: 'default',
    priority: 50,
    duration: [30, 30],
    window: { not_before: '09:00', not_after: '17:00' },
    cardinality: { period: { unit: 'day', interval: 1 }, per_day: { count: [2, 2] } },
  };
  const c = constructGreedy(input({ intents: [stacked], horizon: { start: '2026-07-04', end: '2026-07-04' } }));
  const reads = c.placements.filter((p) => p.intent.id === 'reading');
  assert.equal(reads.length, 2);
  assert.ok(reads.every((p) => p.date === '2026-07-04'));
  assert.equal(c.conflicts.length, 0);
});
