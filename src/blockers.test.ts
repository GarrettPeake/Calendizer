import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyBlockerSemantics } from './blockers';
import { ConflictReport, Instance, Intent } from './types';

function intent(subject: string, patch: Partial<Intent> = {}): Intent {
  return { subject, mode: 'default', priority: 50, duration: [60, 60], window: {}, cardinality: {}, ...patch };
}

function inst(intentId: string, subject: string, start: string, end: string, patch: Partial<Instance> = {}): Instance {
  return {
    uid: `${intentId}|x`,
    intentId,
    subject,
    date: start.slice(0, 10),
    start,
    end,
    durationMin: 60,
    ...patch,
  };
}

const WORK = intent('Work', { blocker: true, id: 'work' });
const ERRAND = intent('errand', { id: 'errand' });

test('marks blocker instances and labels overlapped events', () => {
  const instances = [
    inst('work', 'Work', '2026-07-06T09:00', '2026-07-06T17:00'),
    inst('errand', 'errand', '2026-07-06T10:00', '2026-07-06T11:00'),
    inst('errand', 'errand', '2026-07-06T18:00', '2026-07-06T19:00', { uid: 'errand|y' }),
  ];
  const r = applyBlockerSemantics(instances, [], [WORK, ERRAND]);
  assert.equal(r.instances[0].blocker, true);
  assert.deepEqual(r.instances[1].blockedBy, ['Work']);
  assert.equal(r.instances[2].blockedBy, undefined); // outside the zone
});

test('intent without an explicit id matches via the subject slug', () => {
  const blocker = intent('Deep Work', { blocker: true }); // id defaults to "deep-work"
  const instances = [inst('deep-work', 'Deep Work', '2026-07-06T09:00', '2026-07-06T12:00')];
  const r = applyBlockerSemantics(instances, [], [blocker]);
  assert.equal(r.instances[0].blocker, true);
});

test('absorbs overlap conflicts involving a blocker, keeps everything else', () => {
  const conflicts: ConflictReport[] = [
    { kind: 'overlap', message: 'x', involved: ['errand', 'Work'], date: '2026-07-06' },
    { kind: 'overlap', message: 'y', involved: ['dinner', 'concert'], date: '2026-07-06' },
    { kind: 'window-unsatisfiable', message: 'z', involved: ['Work'], date: '2026-07-06' },
  ];
  const r = applyBlockerSemantics([], conflicts, [WORK, ERRAND]);
  assert.deepEqual(
    r.conflicts.map((c) => c.message),
    ['y', 'z'] // real-event overlap survives; the blocker's own unsatisfiability survives
  );
});

test('idempotent, and strips a stale blockedBy from storage', () => {
  const instances = [
    inst('work', 'Work', '2026-07-06T09:00', '2026-07-06T17:00'),
    inst('errand', 'errand', '2026-07-06T18:00', '2026-07-06T19:00', { blockedBy: ['Work'] }),
  ];
  const once = applyBlockerSemantics(instances, [], [WORK, ERRAND]);
  assert.equal(once.instances[1].blockedBy, undefined);
  assert.ok(!('blockedBy' in once.instances[1]));
  const twice = applyBlockerSemantics(once.instances, once.conflicts, [WORK, ERRAND]);
  assert.deepEqual(twice.instances, once.instances);
});

test('no blockers ⇒ pass-through (same references)', () => {
  const instances = [inst('errand', 'errand', '2026-07-06T10:00', '2026-07-06T11:00')];
  const conflicts: ConflictReport[] = [{ kind: 'overlap', message: 'x', involved: ['a', 'b'] }];
  const r = applyBlockerSemantics(instances, conflicts, [ERRAND]);
  assert.equal(r.instances, instances);
  assert.equal(r.conflicts, conflicts);
});
