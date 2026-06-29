/**
 * Shared step definitions — the complete DSL feature authors write against.
 * See features/DSL.md for the human-readable reference.
 *
 * Conventions:
 *  - Times are "HH:MM" (24h). Dates are "YYYY-MM-DD".
 *  - "occurrence of X" matches instances whose subject === X.
 *  - Assertions favour the spec's GUARANTEED behaviour (hard constraints,
 *    counts, windows, ordering, non-overlap) plus deterministic exact times.
 */
import { Given, When, Then, DataTable } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { CalendizerWorld, parseLooseJson } from '../support/world';
import { Intent, Mode, CalendarEvent, Instance } from '../../src/types';

function timeOf(dt: string): string {
  return dt.split('T')[1];
}
function startsAbsMin(i: Instance): number {
  const [h, m] = timeOf(i.start).split(':').map(Number);
  return h * 60 + m;
}
function overlaps(a: Instance, b: Instance): boolean {
  return a.start < b.end && b.start < a.end;
}

/* ----------------------------- Background: config ----------------------------- */

Given('the location is latitude {float} longitude {float}', function (this: CalendizerWorld, lat: number, lon: number) {
  this.config.location = { lat, lon };
});

Given('the UTC offset is {int} minutes', function (this: CalendizerWorld, off: number) {
  this.config.utcOffsetMinutes = off;
});

Given('wakeup is {string}', function (this: CalendizerWorld, t: string) {
  this.config.wakeup = t;
});

Given('sleep is {string}', function (this: CalendizerWorld, t: string) {
  this.config.sleep = t;
});

Given('wakeup is {string} and sleep is {string}', function (this: CalendizerWorld, w: string, s: string) {
  this.config.wakeup = w;
  this.config.sleep = s;
});

Given('padding is {int} minutes', function (this: CalendizerWorld, p: number) {
  this.config.padding = p;
});

Given('the grid is {int} minutes', function (this: CalendizerWorld, g: number) {
  this.config.grid = g;
});

Given('the minimum break is {int} minutes', function (this: CalendizerWorld, m: number) {
  this.config.min_break = m;
});

Given('the maximum block is {int} minutes', function (this: CalendizerWorld, m: number) {
  this.config.max_block = m;
});

Given('fill toward max is enabled', function (this: CalendizerWorld) {
  this.config.fillToMax = true;
});

Given('the planning horizon is {string} to {string}', function (this: CalendizerWorld, a: string, b: string) {
  this.horizon = { start: a, end: b };
});

Given('a mode {string} spanning {string} to {string}', function (this: CalendizerWorld, name: string, a: string, b: string) {
  this.modes.push({ name, span: [a, b] } as Mode);
});

/* ----------------------------- Existing calendar ----------------------------- */

Given('an existing fixed event {string} on {string} from {string} to {string}', function (
  this: CalendizerWorld,
  subject: string,
  date: string,
  from: string,
  to: string
) {
  this.existing.push({
    uid: `fixed-${this.existing.length}`,
    subject,
    start: `${date}T${from}`,
    end: `${date}T${to}`,
  } as CalendarEvent);
});

Given('an existing fixed event {string} from {string} to {string}', function (
  this: CalendizerWorld,
  subject: string,
  fromDt: string,
  toDt: string
) {
  this.existing.push({
    uid: `fixed-${this.existing.length}`,
    subject,
    start: fromDt,
    end: toDt,
  } as CalendarEvent);
});

Given('a previously derived instance for intent {string} with uid {string} on {string} from {string} to {string}', function (
  this: CalendizerWorld,
  intentId: string,
  uid: string,
  date: string,
  from: string,
  to: string
) {
  this.existing.push({
    uid,
    subject: intentId,
    intentId,
    start: `${date}T${from}`,
    end: `${date}T${to}`,
  } as CalendarEvent);
});

Given('a previously derived instance {string} with uid {string} for intent {string} on {string} from {string} to {string}', function (
  this: CalendizerWorld,
  subject: string,
  uid: string,
  intentId: string,
  date: string,
  from: string,
  to: string
) {
  this.existing.push({
    uid,
    subject,
    intentId,
    start: `${date}T${from}`,
    end: `${date}T${to}`,
  } as CalendarEvent);
});

/* --------------------------------- Intents --------------------------------- */

Given('the intent:', addIntentDoc);
Given('I have the intent:', addIntentDoc);
When('I add the intent:', addIntentDoc);
function addIntentDoc(this: CalendizerWorld, doc: string) {
  const parsed = parseLooseJson(doc) as Intent;
  this.intents.push(parsed);
}

Given('the intents:', addIntentsDoc);
When('I add the intents:', addIntentsDoc);
function addIntentsDoc(this: CalendizerWorld, doc: string) {
  const parsed = parseLooseJson(doc);
  const arr = Array.isArray(parsed) ? parsed : [parsed];
  for (const i of arr) this.intents.push(i as Intent);
}

When('I solve', function (this: CalendizerWorld) {
  this.run();
});

When('I re-solve', function (this: CalendizerWorld) {
  this.run();
});

/* -------------------------------- Counts -------------------------------- */

Then('there are {int} occurrences of {string}', function (this: CalendizerWorld, n: number, subject: string) {
  const got = this.bySubject(subject).length;
  assert.equal(got, n, `expected ${n} occurrences of "${subject}", got ${got}\n${this.describeSchedule()}`);
});

Then('there is {int} occurrence of {string}', function (this: CalendizerWorld, n: number, subject: string) {
  const got = this.bySubject(subject).length;
  assert.equal(got, n, `expected ${n} occurrence of "${subject}", got ${got}\n${this.describeSchedule()}`);
});

Then('there are no occurrences of {string}', function (this: CalendizerWorld, subject: string) {
  const got = this.bySubject(subject).length;
  assert.equal(got, 0, `expected no occurrences of "${subject}", got ${got}`);
});

Then('{string} has between {int} and {int} occurrences', function (this: CalendizerWorld, subject: string, lo: number, hi: number) {
  const got = this.bySubject(subject).length;
  assert.ok(got >= lo && got <= hi, `expected ${lo}-${hi} occurrences of "${subject}", got ${got}`);
});

Then('there are {int} occurrences of {string} on {string}', function (this: CalendizerWorld, n: number, subject: string, date: string) {
  const got = this.onDate(subject, date).length;
  assert.equal(got, n, `expected ${n} of "${subject}" on ${date}, got ${got}`);
});

Then('the total number of placed occurrences is {int}', function (this: CalendizerWorld, n: number) {
  assert.equal(this.instances.length, n, `expected ${n} total, got ${this.instances.length}\n${this.describeSchedule()}`);
});

/* -------------------------------- Placement -------------------------------- */

Then('an occurrence of {string} is placed on {string}', function (this: CalendizerWorld, subject: string, date: string) {
  assert.ok(this.onDate(subject, date).length >= 1, `no "${subject}" on ${date}\n${this.describeSchedule()}`);
});

Then('no occurrence of {string} is placed on {string}', function (this: CalendizerWorld, subject: string, date: string) {
  assert.equal(this.onDate(subject, date).length, 0, `unexpected "${subject}" on ${date}`);
});

Then('the occurrence of {string} on {string} starts at {string}', function (this: CalendizerWorld, subject: string, date: string, t: string) {
  assert.equal(timeOf(this.oneOn(subject, date).start), t);
});

Then('the occurrence of {string} on {string} ends at {string}', function (this: CalendizerWorld, subject: string, date: string, t: string) {
  assert.equal(timeOf(this.oneOn(subject, date).end), t);
});

Then('the occurrence of {string} on {string} runs from {string} to {string}', function (this: CalendizerWorld, subject: string, date: string, from: string, to: string) {
  const inst = this.oneOn(subject, date);
  assert.equal(timeOf(inst.start), from, `start mismatch`);
  assert.equal(timeOf(inst.end), to, `end mismatch`);
});

Then('every occurrence of {string} starts at or after {string}', function (this: CalendizerWorld, subject: string, t: string) {
  for (const i of this.bySubject(subject)) assert.ok(timeOf(i.start) >= t, `${i.start} starts before ${t}`);
});

Then('every occurrence of {string} ends at or before {string}', function (this: CalendizerWorld, subject: string, t: string) {
  for (const i of this.bySubject(subject)) assert.ok(timeOf(i.end) <= t, `${i.start}-${timeOf(i.end)} ends after ${t}`);
});

Then('every occurrence of {string} starts at or before {string}', function (this: CalendizerWorld, subject: string, t: string) {
  for (const i of this.bySubject(subject)) assert.ok(timeOf(i.start) <= t, `${i.start} starts after ${t}`);
});

Then('every occurrence of {string} starts at {string}', function (this: CalendizerWorld, subject: string, t: string) {
  const list = this.bySubject(subject);
  assert.ok(list.length > 0, `no occurrences of "${subject}"`);
  for (const i of list) assert.equal(timeOf(i.start), t, `${i.start} != ${t}`);
});

Then('every occurrence of {string} lasts {int} minutes', function (this: CalendizerWorld, subject: string, mins: number) {
  for (const i of this.bySubject(subject)) assert.equal(i.durationMin, mins, `${i.start} lasts ${i.durationMin}, expected ${mins}`);
});

Then('every occurrence of {string} lasts between {int} and {int} minutes', function (this: CalendizerWorld, subject: string, lo: number, hi: number) {
  for (const i of this.bySubject(subject)) assert.ok(i.durationMin >= lo && i.durationMin <= hi, `${i.start} lasts ${i.durationMin}, want ${lo}-${hi}`);
});

Then('every occurrence of {string} is aligned to the grid', function (this: CalendizerWorld, subject: string) {
  const g = this.config.grid;
  for (const i of this.bySubject(subject)) assert.equal(startsAbsMin(i) % g, 0, `${i.start} not aligned to ${g}m grid`);
});

Then('every occurrence is aligned to the grid', function (this: CalendizerWorld) {
  const g = this.config.grid;
  for (const i of this.instances) {
    // pinned starts may legitimately sit off-grid; skip exact-pin instances? keep strict.
    assert.equal(startsAbsMin(i) % g, 0, `${i.subject} @ ${i.start} not aligned to ${g}m grid`);
  }
});

Then('every occurrence of {string} falls on a weekday in {string}', function (this: CalendizerWorld, subject: string, list: string) {
  const allowed = new Set(list.split(',').map((s) => s.trim().toUpperCase()));
  const codes = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
  for (const i of this.bySubject(subject)) {
    const wd = codes[new Date(i.date + 'T00:00:00Z').getUTCDay()];
    assert.ok(allowed.has(wd), `${i.date} (${wd}) not in {${[...allowed].join(',')}}`);
  }
});

Then('occurrences of {string} fall on dates {string}', function (this: CalendizerWorld, subject: string, list: string) {
  const want = list.split(',').map((s) => s.trim()).sort();
  const got = [...new Set(this.bySubject(subject).map((i) => i.date))].sort();
  assert.deepEqual(got, want);
});

/* -------------------------------- Overlap -------------------------------- */

Then('no two occurrences overlap', function (this: CalendizerWorld) {
  const list = this.instances;
  for (let i = 0; i < list.length; i++)
    for (let j = i + 1; j < list.length; j++)
      assert.ok(!overlaps(list[i], list[j]), `overlap: ${list[i].subject}@${list[i].start} & ${list[j].subject}@${list[j].start}`);
});

Then('no two occurrences of {string} overlap', function (this: CalendizerWorld, subject: string) {
  const list = this.bySubject(subject);
  for (let i = 0; i < list.length; i++)
    for (let j = i + 1; j < list.length; j++)
      assert.ok(!overlaps(list[i], list[j]), `overlap: ${list[i].start} & ${list[j].start}`);
});

Then('occurrences of {string} do not overlap occurrences of {string}', function (this: CalendizerWorld, a: string, b: string) {
  for (const x of this.bySubject(a))
    for (const y of this.bySubject(b))
      assert.ok(!overlaps(x, y), `overlap: ${a}@${x.start} & ${b}@${y.start}`);
});

Then('no occurrence overlaps the fixed event {string}', function (this: CalendizerWorld, subject: string) {
  const fixed = this.existing.filter((e) => e.subject === subject && !e.intentId);
  for (const f of fixed)
    for (const i of this.instances)
      assert.ok(!(i.start < f.end && f.start < i.end), `${i.subject}@${i.start} overlaps fixed ${subject}@${f.start}`);
});

Then('occurrences of {string} are at least {int} minutes apart', function (this: CalendizerWorld, subject: string, gap: number) {
  const list = this.bySubject(subject);
  for (let i = 1; i < list.length; i++) {
    if (list[i].date !== list[i - 1].date) continue;
    const g = startsAbsMin(list[i]) - (startsAbsMin(list[i - 1]) + list[i - 1].durationMin);
    assert.ok(g >= gap, `gap ${g} < ${gap} between ${list[i - 1].start} and ${list[i].start}`);
  }
});

/* -------------------------------- Children -------------------------------- */

Then('the occurrence of {string} on {string} has children in order {string}', function (this: CalendizerWorld, subject: string, date: string, list: string) {
  const want = list.split(',').map((s) => s.trim());
  const inst = this.oneOn(subject, date);
  const got = (inst.children ?? []).map((c) => c.subject);
  assert.deepEqual(got, want);
});

Then('the children of {string} on {string} are contiguous', function (this: CalendizerWorld, subject: string, date: string) {
  const inst = this.oneOn(subject, date);
  const ch = inst.children ?? [];
  for (let i = 1; i < ch.length; i++) assert.equal(ch[i].start, ch[i - 1].end, `gap between ${ch[i - 1].subject} and ${ch[i].subject}`);
  if (ch.length) {
    assert.equal(ch[0].start, inst.start, 'first child must start with parent');
    assert.equal(ch[ch.length - 1].end, inst.end, 'last child must end with parent');
  }
});

Then('the child {string} of {string} on {string} lasts {int} minutes', function (this: CalendizerWorld, child: string, subject: string, date: string, mins: number) {
  const inst = this.oneOn(subject, date);
  const c = (inst.children ?? []).find((x) => x.subject === child);
  assert.ok(c, `no child "${child}"`);
  const dur = (Date.parse(c!.end + ':00Z') - Date.parse(c!.start + ':00Z')) / 60000;
  assert.equal(dur, mins);
});

/* -------------------------------- Sleep -------------------------------- */

Then('the occurrence of {string} on {string} is placed during sleep', function (this: CalendizerWorld, subject: string, date: string) {
  assert.equal(this.oneOn(subject, date).placedDuringSleep, true, 'expected placedDuringSleep');
});

Then('no occurrence is marked as placed during sleep', function (this: CalendizerWorld) {
  const bad = this.instances.filter((i) => i.placedDuringSleep);
  assert.equal(bad.length, 0, `placed during sleep: ${bad.map((i) => i.subject + '@' + i.start).join(', ')}`);
});

/* -------------------------------- Conflicts -------------------------------- */

Then('there are no conflicts', function (this: CalendizerWorld) {
  assert.equal(this.conflicts.length, 0, `conflicts: ${JSON.stringify(this.conflicts, null, 2)}`);
});

Then('there is a conflict', function (this: CalendizerWorld) {
  assert.ok(this.conflicts.length >= 1, 'expected at least one conflict');
});

Then('there are {int} conflicts', function (this: CalendizerWorld, n: number) {
  assert.equal(this.conflicts.length, n, `conflicts: ${JSON.stringify(this.conflicts)}`);
});

Then('there is a conflict involving {string}', function (this: CalendizerWorld, who: string) {
  assert.ok(this.conflicts.some((c) => c.involved.includes(who)), `no conflict involving "${who}": ${JSON.stringify(this.conflicts)}`);
});

Then('there is a conflict involving {string} and {string}', function (this: CalendizerWorld, a: string, b: string) {
  assert.ok(this.conflicts.some((c) => c.involved.includes(a) && c.involved.includes(b)), `no conflict involving "${a}" and "${b}": ${JSON.stringify(this.conflicts)}`);
});

Then('there is a conflict of kind {string}', function (this: CalendizerWorld, kind: string) {
  assert.ok(this.conflicts.some((c) => c.kind === kind), `no "${kind}" conflict: ${JSON.stringify(this.conflicts)}`);
});

/* -------------------------------- Updates / re-solve -------------------------------- */

Then('the update for uid {string} is {string}', function (this: CalendizerWorld, uid: string, kind: string) {
  const u = this.updates.find((x) => x.uid === uid);
  assert.ok(u, `no update for uid "${uid}"`);
  assert.equal(u!.kind, kind);
});

Then('there are {int} {string} updates', function (this: CalendizerWorld, n: number, kind: string) {
  const got = this.updates.filter((u) => u.kind === kind).length;
  assert.equal(got, n, `expected ${n} ${kind} updates, got ${got}: ${JSON.stringify(this.updates.map((u) => [u.kind, u.uid]))}`);
});

Then('there is a {string} update', function (this: CalendizerWorld, kind: string) {
  assert.ok(this.updates.some((u) => u.kind === kind), `no ${kind} update`);
});

/* -------------------------------- Table assertions -------------------------------- */

// | date | start | end | — exact schedule of one subject.
Then('the occurrences of {string} are:', function (this: CalendizerWorld, subject: string, table: DataTable) {
  const rows = table.hashes();
  const got = this.bySubject(subject).map((i) => ({ date: i.date, start: timeOf(i.start), end: timeOf(i.end) }));
  const want = rows.map((r) => ({ date: r.date, start: r.start, end: r.end }));
  assert.deepEqual(got, want, `schedule mismatch for "${subject}"\nGOT: ${JSON.stringify(got)}\nWANT: ${JSON.stringify(want)}`);
});

// | subject | date | start | end | — exact full schedule.
Then('the schedule is:', function (this: CalendizerWorld, table: DataTable) {
  const rows = table.hashes();
  const got = this.instances.map((i) => ({ subject: i.subject, date: i.date, start: timeOf(i.start), end: timeOf(i.end) }));
  const want = rows.map((r) => ({ subject: r.subject, date: r.date, start: r.start, end: r.end }));
  assert.deepEqual(got, want, `\nGOT:  ${JSON.stringify(got, null, 2)}\nWANT: ${JSON.stringify(want, null, 2)}`);
});

/* -------------------------------- Debug -------------------------------- */

Then('print the schedule', function (this: CalendizerWorld) {
  // eslint-disable-next-line no-console
  console.log('\nSCHEDULE:\n' + this.describeSchedule() + '\nCONFLICTS: ' + JSON.stringify(this.conflicts, null, 2));
});
