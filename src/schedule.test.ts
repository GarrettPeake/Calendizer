/**
 * Unit tests for the pure schedule-assembly pipeline. Run with:
 *   node --test --require ts-node/register src/schedule.test.ts   (npm run test:unit)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assembleSchedule, AssembleInput } from './schedule';
import { GlobalConfig, Instance, Intent } from './types';

const config: GlobalConfig = {
  wakeup: '07:00',
  sleep: '23:00',
  padding: 0,
  grid: 5,
  min_break: 15,
  max_block: 180,
  utcOffsetMinutes: 0,
  fillToMax: false,
};

const base = (over: Partial<AssembleInput> = {}): AssembleInput => ({
  config,
  intents: [],
  modeRecords: [],
  frozen: [],
  nowDT: '2026-07-01T09:00',
  today: '2026-07-01',
  ...over,
});

const dailyIntent = (over: Partial<Intent> = {}): Intent => ({
  id: 'walk',
  subject: 'walk',
  mode: 'default',
  priority: 50,
  duration: [30, 30],
  window: { not_before: '08:00', not_after: '20:00' },
  cardinality: { period: { unit: 'day', interval: 1 }, per_day: { count: [1, 1] } },
  ...over,
});

test('a live daily intent produces future occurrences and no reaping', () => {
  const r = assembleSchedule(base({ intents: [dailyIntent()] }));
  assert.ok(r.instances.length > 0);
  assert.equal(r.reapedIntentIds.length, 0);
  assert.equal(r.horizon.end, '2027-07-01'); // today + 365
});

test('a fully-passed one-off intent is reaped', () => {
  const past = dailyIntent({
    id: 'coffee',
    subject: 'coffee',
    cardinality: { days: { dates: ['2026-06-20'] } },
  });
  const r = assembleSchedule(base({ intents: [past] }));
  assert.deepEqual(r.reapedIntentIds, ['coffee']);
  assert.ok(!r.instances.some((i) => i.intentId === 'coffee'));
});

test('the frozen past is preserved verbatim over a re-solve (immutability)', () => {
  // A frozen occurrence earlier today that the live intent would also project.
  const frozen: Instance[] = [
    {
      uid: 'walk|day:2026-07-01|0',
      intentId: 'walk',
      subject: 'walk',
      date: '2026-07-01',
      start: '2026-07-01T08:00',
      end: '2026-07-01T08:30',
      durationMin: 30,
    },
  ];
  const r = assembleSchedule(base({ intents: [dailyIntent()], frozen }));
  const kept = r.instances.find((i) => i.uid === 'walk|day:2026-07-01|0');
  assert.ok(kept, 'frozen occurrence survives');
  assert.equal(kept!.start, '2026-07-01T08:00'); // unchanged, even though now=09:00
});

test('retention drops frozen history older than the window', () => {
  const old: Instance[] = [
    {
      uid: 'walk|day:2026-01-01|0',
      intentId: 'walk',
      subject: 'walk',
      date: '2026-01-01',
      start: '2026-01-01T08:00',
      end: '2026-01-01T08:30',
      durationMin: 30,
    },
  ];
  const r = assembleSchedule(base({ intents: [dailyIntent()], frozen: old, retentionDays: 90 }));
  assert.ok(!r.instances.some((i) => i.date === '2026-01-01'));
  // horizon.start is the Monday of (today - 90d)
  assert.ok(r.horizon.start <= '2026-04-02');
});
