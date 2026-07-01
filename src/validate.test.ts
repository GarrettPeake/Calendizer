/**
 * Unit tests for the shared form validators. Run with:
 *   node --test --require ts-node/register src/validate.test.ts   (npm run test:unit)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Intent } from './types';
import { validateIntent, validateMode, validateConfig, validateCredentials, ValidationResult } from './validate';

const hasErr = (r: ValidationResult, f: string) => r.errors.some((e) => e.field === f || e.field.startsWith(f + '.'));
const hasWarn = (r: ValidationResult, f: string) => r.warnings.some((e) => e.field === f || e.field.startsWith(f + '.'));

const baseIntent = (over: Partial<Intent> = {}): Intent => ({
  subject: 'bike',
  mode: 'default',
  priority: 50,
  duration: [30, 60],
  window: {},
  cardinality: { period: { unit: 'week', interval: 1 }, days: { count: [1, 2] } },
  ...over,
});

/* ------------------------------- Intent ------------------------------- */

test('a well-formed intent passes', () => {
  assert.equal(validateIntent(baseIntent()).ok, true);
});

test('subject: empty and symbol-only are blocked', () => {
  assert.ok(hasErr(validateIntent(baseIntent({ subject: '   ' })), 'subject'));
  assert.ok(hasErr(validateIntent(baseIntent({ subject: '!!!' })), 'subject'));
  // ...but an explicit id rescues a symbol-only subject
  assert.ok(!hasErr(validateIntent(baseIntent({ subject: '!!!', id: 'x1' })), 'subject'));
});

test('priority: non-integer blocks, out-of-range warns', () => {
  assert.ok(hasErr(validateIntent(baseIntent({ priority: NaN })), 'priority'));
  assert.ok(hasErr(validateIntent(baseIntent({ priority: 3.5 })), 'priority'));
  assert.ok(hasWarn(validateIntent(baseIntent({ priority: 500 })), 'priority'));
  assert.ok(validateIntent(baseIntent({ priority: 0 })).ok);
});

test('duration: min>max, negatives, and non-integers block', () => {
  assert.ok(hasErr(validateIntent(baseIntent({ duration: [60, 30] })), 'duration'));
  assert.ok(hasErr(validateIntent(baseIntent({ duration: [-5, 60] })), 'duration'));
  assert.ok(hasErr(validateIntent(baseIntent({ duration: [30, 0] })), 'duration'));
  assert.ok(hasErr(validateIntent(baseIntent({ duration: [30.5, 60] })), 'duration'));
});

test('duration: cannot fit a clock-bounded window', () => {
  const r = validateIntent(baseIntent({ duration: [120, 120], window: { not_before: '09:00', not_after: '10:00' } }));
  assert.ok(hasErr(r, 'duration'));
});

test('window: inverted clock bounds block; bad clock blocks; marker+clock does not warn', () => {
  assert.ok(hasErr(validateIntent(baseIntent({ window: { not_before: '20:00', not_after: '08:00' } })), 'window'));
  assert.ok(hasErr(validateIntent(baseIntent({ window: { not_before: '9am' } })), 'window'));
  // a wakeup(marker)→22:00(clock) window is fine — no noisy "may be too short" warning
  const r = validateIntent(baseIntent({ duration: [60, 60], window: { not_before: { marker: 'wakeup' }, not_after: '22:00' } }));
  assert.ok(!hasWarn(r, 'duration'));
});

test('window overrides: valid passes; bad clock, bad weekday key, and inverted bounds block', () => {
  assert.ok(validateIntent(baseIntent({ window: { not_before: '17:00', overrides: { 'TU,TH': { not_after: '21:00' } } } })).ok);
  assert.ok(hasErr(validateIntent(baseIntent({ window: { overrides: { TU: { not_before: '9am' } } } })), 'window.overrides'));
  assert.ok(hasErr(validateIntent(baseIntent({ window: { overrides: { XX: { not_after: '21:00' } } } })), 'window.overrides'));
  assert.ok(hasErr(validateIntent(baseIntent({ window: { overrides: { MO: { not_before: '20:00', not_after: '10:00' } } } })), 'window.overrides'));
});

test('interval below 1 blocks', () => {
  assert.ok(hasErr(validateIntent(baseIntent({ cardinality: { period: { unit: 'week', interval: 0 }, days: { count: [1, 1] } } })), 'period'));
});

test('days.count: min>max blocks; over-cap warns; filler min 0 is allowed', () => {
  assert.ok(hasErr(validateIntent(baseIntent({ cardinality: { period: { unit: 'week' }, days: { count: [3, 1] } } })), 'days'));
  assert.ok(hasWarn(validateIntent(baseIntent({ cardinality: { period: { unit: 'week' }, days: { count: [9, 9] } } })), 'days'));
  assert.ok(validateIntent(baseIntent({ cardinality: { period: { unit: 'week' }, days: { count: [0, 3] } } })).ok);
});

test('weekdays empty and dates empty/malformed block; horizon-out-of-range warns', () => {
  assert.ok(hasErr(validateIntent(baseIntent({ cardinality: { period: { unit: 'week' }, days: { weekdays: [] } } })), 'days'));
  assert.ok(hasErr(validateIntent(baseIntent({ cardinality: { days: { dates: [] } } })), 'days'));
  assert.ok(hasErr(validateIntent(baseIntent({ cardinality: { days: { dates: ['2026-2-3'] } } })), 'days'));
  const r = validateIntent(baseIntent({ cardinality: { days: { dates: ['2030-01-01'] } } }), { horizon: { start: '2026-01-01', end: '2026-12-31' } });
  assert.ok(hasWarn(r, 'days'));
});

test('per_day and total bounds', () => {
  assert.ok(hasErr(validateIntent(baseIntent({ cardinality: { days: { count: [1, 1] }, per_day: { count: [3, 1] } } })), 'per_day'));
  assert.ok(hasErr(validateIntent(baseIntent({ cardinality: { days: { count: [1, 1] }, total: [5, 2] } })), 'total'));
  assert.ok(hasErr(validateIntent(baseIntent({ cardinality: { days: { count: [1, 1] }, total: [null, 0] } })), 'total'));
});

test('mode: dangling reference warns when modes are known', () => {
  const r = validateIntent(baseIntent({ mode: 'ghost' }), { modes: [{ name: 'trip', span: ['2026-01-01', '2026-01-05'] }] as any });
  assert.ok(hasWarn(r, 'mode'));
  // a known id/name does not warn
  assert.ok(!hasWarn(validateIntent(baseIntent({ mode: 'm1' }), { modes: [{ id: 'm1', name: 'trip', span: ['2026-01-01', '2026-01-05'] }] as any }), 'mode'));
});

test('children: need a fill child; fixed must fit; every child named', () => {
  assert.ok(hasErr(validateIntent(baseIntent({ duration: [60, 60], children: [{ subject: 'a', duration: 10 }] })), 'children'));
  assert.ok(hasErr(validateIntent(baseIntent({ duration: [30, 30], children: [{ subject: 'a', duration: 40 }, { subject: 'b', weight: 1 }] })), 'children'));
  assert.ok(hasErr(validateIntent(baseIntent({ duration: [60, 60], children: [{ subject: '', weight: 1 }] })), 'children'));
  assert.ok(validateIntent(baseIntent({ duration: [60, 60], children: [{ subject: 'a', duration: 10 }, { subject: 'b', weight: 1 }] })).ok);
});

/* ------------------------------- Mode ------------------------------- */

test('mode: name required, dates valid, from<=to', () => {
  assert.ok(hasErr(validateMode({ name: '  ', span: ['2026-01-01', '2026-01-02'] }), 'name'));
  assert.ok(hasErr(validateMode({ name: 'x', span: ['2026-13-40', '2026-01-02'] }), 'span'));
  assert.ok(hasErr(validateMode({ name: 'x', span: ['2026-01-05', '2026-01-01'] }), 'span'));
  assert.ok(validateMode({ name: 'x', span: ['2026-01-01', '2026-01-01'] }).ok); // single-day is valid
});

test('mode: inclusive overlap (incl. touching endpoints) blocks; separated is ok', () => {
  const others = [{ id: 'm1', name: 'prev', span: ['2026-10-01', '2026-10-03'] as [string, string] }];
  assert.ok(hasErr(validateMode({ name: 'trip', span: ['2026-10-03', '2026-10-05'] }, { others }), 'span')); // touches 10-03
  assert.ok(hasErr(validateMode({ name: 'trip', span: ['2026-10-02', '2026-10-05'] }, { others }), 'span')); // straddles
  assert.ok(validateMode({ name: 'trip', span: ['2026-10-04', '2026-10-06'] }, { others }).ok); // clear
});

test('mode: duplicate name warns; out-of-horizon warns', () => {
  assert.ok(hasWarn(validateMode({ name: 'Trip', span: ['2026-10-04', '2026-10-06'] }, { others: [{ id: 'm1', name: 'trip', span: ['2026-01-01', '2026-01-02'] }] }), 'name'));
  assert.ok(hasWarn(validateMode({ name: 'x', span: ['2030-01-01', '2030-01-05'] }, { horizon: { start: '2026-01-01', end: '2026-12-31' } }), 'span'));
});

/* ------------------------------- Config ------------------------------- */

test('config: bad time, bad grid, negative padding block; sleep relationship warns', () => {
  const good = { wakeup: '07:00', sleep: '23:00', grid: 5, padding: 0 } as any;
  assert.ok(validateConfig(good).ok);
  assert.ok(hasErr(validateConfig({ ...good, wakeup: '7am' }), 'wakeup'));
  assert.ok(hasErr(validateConfig({ ...good, grid: NaN }), 'grid'));
  assert.ok(hasErr(validateConfig({ ...good, grid: 0 }), 'grid'));
  assert.ok(hasErr(validateConfig({ ...good, padding: -1 }), 'padding'));
  assert.ok(hasWarn(validateConfig({ ...good, wakeup: '08:00', sleep: '08:00' }), 'sleep'));
  assert.ok(hasWarn(validateConfig({ ...good, wakeup: '08:00', sleep: '02:00' }), 'sleep'));
});

/* ------------------------------- Credentials ------------------------------- */

test('credentials: login only needs non-empty fields', () => {
  assert.ok(hasErr(validateCredentials('login', { username: '', password: 'x' }), 'username'));
  assert.ok(hasErr(validateCredentials('login', { username: 'a', password: '' }), 'password'));
  assert.ok(validateCredentials('login', { username: 'a', password: 'x' }).ok);
});

test('credentials: register enforces length, charset, invite, confirm', () => {
  assert.ok(hasErr(validateCredentials('register', { username: 'ab', password: 'longenough1', invite: 'x' }), 'username'));
  assert.ok(hasErr(validateCredentials('register', { username: 'bad name', password: 'longenough1', invite: 'x' }), 'username'));
  assert.ok(hasErr(validateCredentials('register', { username: 'garrett', password: 'short', invite: 'x' }), 'password'));
  assert.ok(hasErr(validateCredentials('register', { username: 'garrett', password: 'longenough1', invite: '' }), 'invite'));
  assert.ok(hasErr(validateCredentials('register', { username: 'garrett', password: 'longenough1', invite: 'x', confirm: 'nope' }), 'confirm'));
  assert.ok(validateCredentials('register', { username: 'garrett', password: 'longenough1', invite: 'x', confirm: 'longenough1' }).ok);
});
