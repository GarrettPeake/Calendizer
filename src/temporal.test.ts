/**
 * Unit tests for the temporal-stability helpers. Run with:
 *   node --test --require ts-node/register src/temporal.test.ts   (npm run test:unit)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ConflictReport, Instance, Intent, Mode } from './types';
import { alignHorizonStart, overlay, realizedConflicts, isFullyPassed } from './temporal';

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

/* ---------------------------- realizedConflicts ---------------------------- */

const conflict = (over: Partial<ConflictReport> = {}): ConflictReport => ({
  kind: 'overlap',
  message: 'x',
  involved: [],
  ...over,
});

test('realizedConflicts: drops a phantom overlap (frozen twin, no real overlap)', () => {
  // "getting ready" 07:00-08:00 and "workout" 08:00-09:00 only touch — no overlap.
  const insts = [
    inst({ uid: 'g', subject: 'getting ready', start: '2026-06-30T07:00', end: '2026-06-30T08:00' }),
    inst({ uid: 'w', subject: 'workout', start: '2026-06-30T08:00', end: '2026-06-30T09:00' }),
  ];
  const c = conflict({ date: '2026-06-30', involved: ['getting ready', 'getting ready', 'workout'] });
  assert.equal(realizedConflicts([c], insts, '2026-06-30').length, 0);
});

test('realizedConflicts: drops a self-overlap when only one instance exists', () => {
  const insts = [inst({ uid: 's', subject: 'Watch sunset', start: '2026-06-30T19:49', end: '2026-06-30T20:29' })];
  const c = conflict({ date: '2026-06-30', involved: ['Watch sunset', 'Watch sunset'] });
  assert.equal(realizedConflicts([c], insts, '2026-06-30').length, 0);
});

test('realizedConflicts: keeps a real overlap between two surviving instances', () => {
  const insts = [
    inst({ uid: 'p', subject: 'pottery', date: '2026-10-19', start: '2026-10-19T18:00', end: '2026-10-19T19:00' }),
    inst({ uid: 's', subject: 'Watch sunset', date: '2026-10-19', start: '2026-10-19T18:30', end: '2026-10-19T19:10' }),
  ];
  const c = conflict({ date: '2026-10-19', involved: ['pottery', 'Watch sunset'] });
  assert.equal(realizedConflicts([c], insts, '2026-06-30').length, 1);
});

test('realizedConflicts: drops a past-day conflict, keeps non-overlap kinds', () => {
  const past = conflict({ date: '2026-06-01', involved: ['a', 'b'] });
  const modeConf = conflict({ kind: 'mode-overlap', date: '2026-08-01', involved: ['m1', 'm2'] });
  const out = realizedConflicts([past, modeConf], [], '2026-06-30');
  assert.deepEqual(out.map((c) => c.kind), ['mode-overlap']);
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
