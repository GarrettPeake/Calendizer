import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reflow, ReflowBubble, ReflowOptions } from './reflow';

const OPTS: ReflowOptions = { grid: 5, padding: 0, obstacles: [] };

function bubble(patch: Partial<ReflowBubble>): ReflowBubble {
  return { floor: 60, max: 60, notBefore: 540, notAfter: 1140, startsAt: null, endsAt: null, weight: 51, ...patch };
}

test('single bubble: floor at window start, snapped up to grid', () => {
  const r = reflow([bubble({ notBefore: 542 })], OPTS);
  assert.ok(r.ok);
  assert.deepEqual(r.starts, [545]);
  assert.deepEqual(r.durations, [60]);
});

test('sequential packing with padding between bubbles', () => {
  const r = reflow([bubble({}), bubble({})], { ...OPTS, padding: 10 });
  assert.ok(r.ok);
  assert.deepEqual(r.starts, [540, 610]);
});

test('obstacle hop: start jumps past the obstacle plus padding, re-snapped', () => {
  const r = reflow([bubble({})], { ...OPTS, padding: 10, obstacles: [[540, 601]] });
  assert.ok(r.ok);
  assert.deepEqual(r.starts, [615]); // 601 + 10 → snap 615
});

test('ordering invalid: window cannot hold the floor → violator index', () => {
  const r = reflow([bubble({}), bubble({ notAfter: 630 })], OPTS);
  assert.ok(!r.ok);
  assert.equal(r.violator, 1); // pushed to 600, needs to end by 630 with 60 floor
});

test('insertion-push solves the coordination chain (C, A, B in one layout)', () => {
  // C window [9:00,10:00], A [9:00,11:00], B [9:00,12:00], 60' each: the chain
  // C@9 → A@10 → B@11 that greedy could never find falls out of ordering.
  const c = bubble({ notBefore: 540, notAfter: 600 });
  const a = bubble({ notBefore: 540, notAfter: 660 });
  const b = bubble({ notBefore: 540, notAfter: 720 });
  const r = reflow([c, a, b], OPTS);
  assert.ok(r.ok);
  assert.deepEqual(r.starts, [540, 600, 660]);
});

test('growth: equal weights share free space equally', () => {
  // 120' of space, two bubbles floor 30 max 90: both should reach 60.
  const a = bubble({ floor: 30, max: 90, notAfter: 660 });
  const b = bubble({ floor: 30, max: 90, notAfter: 660 });
  const r = reflow([a, b], OPTS);
  assert.ok(r.ok);
  assert.deepEqual(r.durations, [60, 60]);
});

test('growth: 2:1 weights split contested space ~2:1', () => {
  // 90' of slack over floors; weights 100 vs 50 → +60 vs +30.
  const a = bubble({ floor: 30, max: 120, notAfter: 690, weight: 100 });
  const b = bubble({ floor: 30, max: 120, notAfter: 690, weight: 50 });
  const r = reflow([a, b], OPTS);
  assert.ok(r.ok);
  assert.deepEqual(r.durations, [90, 60]);
});

test('growth caps exactly on an off-grid window end (sunset edge)', () => {
  // Window ends 9:13 (553): duration lands exactly 43, not 40.
  const r = reflow([bubble({ floor: 30, max: 60, notBefore: 510, notAfter: 553 })], OPTS);
  assert.ok(r.ok);
  assert.deepEqual(r.durations, [43]);
  assert.deepEqual(r.starts, [510]);
});

test('growth pushes a successor until ITS window blocks further growth', () => {
  // A can grow but B must still end by 700: A saturates at 100 (B floor 60).
  const a = bubble({ floor: 40, max: 180, notAfter: 1140 });
  const b = bubble({ floor: 60, max: 60, notAfter: 700 });
  const r = reflow([a, b], OPTS);
  assert.ok(r.ok);
  assert.deepEqual(r.durations, [100, 60]);
  assert.deepEqual(r.starts, [540, 640]);
});

test('ends_at anchor: fixed end, growth extends the start backward', () => {
  const a = bubble({ floor: 30, max: 30, notAfter: 600 });
  const b = bubble({ floor: 30, max: 90, endsAt: 700, notAfter: 700 });
  const r = reflow([a, b], OPTS);
  assert.ok(r.ok);
  // b grows backward from 700 until it hits a's end (570): duration 90 fits at 610.
  assert.deepEqual(r.durations, [30, 90]);
  assert.deepEqual(r.starts, [540, 610]);
});

test('ends_at backward growth stops at the predecessor', () => {
  const a = bubble({ floor: 60, max: 60 }); // 540–600
  const b = bubble({ floor: 30, max: 120, endsAt: 680, notAfter: 680 });
  const r = reflow([a, b], OPTS);
  assert.ok(r.ok);
  assert.deepEqual(r.durations, [60, 80]); // start 600 = a's end
  assert.deepEqual(r.starts, [540, 600]);
});

test('pinned start behind the cursor invalidates the ordering', () => {
  const a = bubble({ floor: 60, max: 60 }); // 540–600
  const p = bubble({ startsAt: 570, notBefore: 570 });
  const r = reflow([a, p], OPTS);
  assert.ok(!r.ok);
  assert.equal(r.violator, 1);
});

test('midnight-crossing obstacle (end past 1440) is honored, not clamped', () => {
  // Obstacle 23:00–25:00 (crossing midnight); bubble window reaches 26:00.
  const r = reflow([bubble({ notBefore: 1380, notAfter: 1560, floor: 30, max: 30 })], {
    ...OPTS,
    obstacles: [[1380, 1500]],
  });
  assert.ok(r.ok);
  assert.deepEqual(r.starts, [1500]);
});

test('negative-start obstacle (spillover from the previous day) blocks the morning', () => {
  const r = reflow([bubble({ notBefore: 0, notAfter: 120, floor: 30, max: 30 })], {
    ...OPTS,
    obstacles: [[-60, 45]],
  });
  assert.ok(r.ok);
  assert.deepEqual(r.starts, [45]);
});

test('deterministic: identical inputs give identical outputs', () => {
  const mk = () => [
    bubble({ floor: 30, max: 120, weight: 71 }),
    bubble({ floor: 45, max: 90, weight: 31, notAfter: 800 }),
    bubble({ floor: 20, max: 60, weight: 51, notAfter: 900 }),
  ];
  const r1 = reflow(mk(), { ...OPTS, obstacles: [[700, 730]] });
  const r2 = reflow(mk(), { ...OPTS, obstacles: [[700, 730]] });
  assert.deepEqual(r1, r2);
});
