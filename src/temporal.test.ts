/**
 * Unit tests for the temporal-stability helpers. Run with:
 *   node --test --require ts-node/register src/temporal.test.ts   (npm run test:unit)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Instance, Intent, Mode } from './types';
import { alignHorizonStart, overlay, isFullyPassed } from './temporal';

const inst = (over: Partial<Instance> = {}): Instance => ({
  uid: 'u',
  intentId: 'i',
  subject: 's',
  date: '2026-06-30',
  start: '2026-06-30T09:00',
  end: '2026-06-30T10:00',
  durationMin: 60,
  ...over,
});

const baseIntent = (over: Partial<Intent> = {}): Intent => ({
  subject: 'workout',
  mode: 'default',
  priority: 50,
  duration: [30, 30],
  window: {},
  cardinality: { period: { unit: 'week', interval: 1 }, days: { count: [3, 3] } },
  ...over,
});

/* ---------------------------- alignHorizonStart ---------------------------- */

test('alignHorizonStart: takes the earlier of ISO-week start and month start', () => {
  // 2026-06-30 is a Tuesday; its ISO week starts Mon 2026-06-29. Month start is
  // 2026-06-01 (earlier) → month wins.
  assert.equal(alignHorizonStart('2026-06-30'), '2026-06-01');
  // 2026-07-01 is a Wednesday; ISO week starts 2026-06-29 (earlier than month
  // start 2026-07-01) → week wins.
  assert.equal(alignHorizonStart('2026-07-01'), '2026-06-29');
});

/* --------------------------------- overlay --------------------------------- */

test('overlay: frozen past kept, projected future kept, projected past dropped', () => {
  const now = '2026-06-30T12:00';
  const frozen = [inst({ uid: 'past-frozen', start: '2026-06-30T08:00', end: '2026-06-30T09:00' })];
  const projected = [
    inst({ uid: 'future', start: '2026-06-30T15:00', end: '2026-06-30T16:00' }),
    inst({ uid: 'projected-past', start: '2026-06-30T07:00', end: '2026-06-30T08:00' }),
  ];
  const out = overlay(frozen, projected, now);
  const uids = out.map((i) => i.uid);
  assert.ok(uids.includes('past-frozen'));
  assert.ok(uids.includes('future'));
  assert.ok(!uids.includes('projected-past'));
});

test('overlay: frozen wins on a uid tie with a projection', () => {
  const now = '2026-06-30T12:00';
  const frozen = [inst({ uid: 'dup', subject: 'frozen-version', start: '2026-06-30T08:00' })];
  const projected = [inst({ uid: 'dup', subject: 'projected-version', start: '2026-06-30T09:00' })];
  const out = overlay(frozen, projected, now);
  assert.equal(out.length, 1);
  assert.equal(out[0].subject, 'frozen-version');
});

test('overlay: output is sorted by start', () => {
  const now = '2026-06-30T00:00';
  const out = overlay(
    [inst({ uid: 'a', start: '2026-06-30T18:00' })],
    [inst({ uid: 'b', start: '2026-06-30T09:00' })],
    now
  );
  assert.deepEqual(out.map((i) => i.uid), ['b', 'a']);
});

/* ------------------------------- isFullyPassed ------------------------------ */

test('isFullyPassed: a past-dated one-off is fully passed', () => {
  const intent = baseIntent({
    cardinality: { days: { dates: ['2026-06-23'] } },
  });
  assert.equal(isFullyPassed(intent, [], '2026-06-30', '2027-06-30'), true);
});

test('isFullyPassed: a future-dated one-off is not passed', () => {
  const intent = baseIntent({
    cardinality: { days: { dates: ['2026-07-05'] } },
  });
  assert.equal(isFullyPassed(intent, [], '2026-06-30', '2027-06-30'), false);
});

test('isFullyPassed: a recurring weekly intent is never passed', () => {
  assert.equal(isFullyPassed(baseIntent(), [], '2026-06-30', '2027-06-30'), false);
});

test('isFullyPassed: a mode-bound intent whose mode has ended is passed', () => {
  const modes: Mode[] = [{ name: 'vacation', span: ['2026-06-01', '2026-06-15'] }];
  const intent = baseIntent({ mode: 'vacation' });
  assert.equal(isFullyPassed(intent, modes, '2026-06-30', '2027-06-30'), true);
});

test('isFullyPassed: a mode-bound intent whose mode is still ahead is not passed', () => {
  const modes: Mode[] = [{ name: 'vacation', span: ['2026-08-01', '2026-08-15'] }];
  const intent = baseIntent({ mode: 'vacation' });
  assert.equal(isFullyPassed(intent, modes, '2026-06-30', '2027-06-30'), false);
});
