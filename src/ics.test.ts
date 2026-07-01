/**
 * Unit tests for ICS rendering. Run with:
 *   node --test --require ts-node/register src/ics.test.ts   (npm run test:unit)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderICS } from './ics';
import { Instance } from './types';

const inst = (over: Partial<Instance> = {}): Instance => ({
  uid: 'i|1',
  intentId: 'night',
  subject: 'Night routine',
  date: '2026-07-03',
  start: '2026-07-03T22:15',
  end: '2026-07-03T23:30',
  durationMin: 75,
  ...over,
});

test('with an offset: emits a fixed-offset VTIMEZONE and TZID-tagged times (not floating)', () => {
  const ics = renderICS([inst()], 'Calendizer', -420);
  assert.match(ics, /BEGIN:VTIMEZONE/);
  assert.match(ics, /TZID:Calendizer\/UTC-0700/);
  assert.match(ics, /TZOFFSETTO:-0700/);
  // The wall-clock time is preserved and tagged with the zone — never a bare
  // floating DTSTART (which Google would misread as UTC and shift by the offset).
  assert.match(ics, /DTSTART;TZID=Calendizer\/UTC-0700:20260703T221500/);
  assert.match(ics, /DTEND;TZID=Calendizer\/UTC-0700:20260703T233000/);
  assert.doesNotMatch(ics, /DTSTART:20260703/);
  // The TZID must contain no colon: an unquoted colon in a parameter value would
  // truncate the TZID and corrupt the time value, and viewers would drop events.
  assert.doesNotMatch(ics, /UTC-07:00/);
});

test('positive offset formats correctly (e.g. +05:30)', () => {
  const ics = renderICS([inst()], 'Calendizer', 330);
  assert.match(ics, /TZID:Calendizer\/UTC\+0530/);
  assert.match(ics, /TZOFFSETTO:\+0530/);
  assert.match(ics, /DTSTART;TZID=Calendizer\/UTC\+0530:20260703T221500/);
});

test('without an offset: falls back to floating times, no VTIMEZONE', () => {
  const ics = renderICS([inst()]);
  assert.doesNotMatch(ics, /VTIMEZONE/);
  assert.match(ics, /DTSTART:20260703T221500/);
});

const withKids = () =>
  inst({
    subject: 'getting ready',
    children: [
      { subject: 'Do hair', start: '2026-07-03T22:15', end: '2026-07-03T22:25' },
      { subject: 'Read', start: '2026-07-03T22:25', end: '2026-07-03T23:30' },
    ],
  });

test('default: children are folded into the parent DESCRIPTION, not separate events', () => {
  const ics = renderICS([withKids()], 'Calendizer', -420);
  // exactly one VEVENT (the parent) — no child events
  assert.equal(ics.match(/BEGIN:VEVENT/g)?.length, 1);
  assert.doesNotMatch(ics, /::child/);
  // a schedule line per child, "H:MM-H:MM (Nm): subject"
  assert.match(ics, /DESCRIPTION:22:15-22:25 \(10m\): Do hair\\n22:25-23:30 \(65m\): Read/);
});

test('subtasksAsEvents=true: children render as their own TZID-tagged VEVENTs', () => {
  const ics = renderICS([withKids()], 'Calendizer', -420, true);
  assert.equal(ics.match(/BEGIN:VEVENT/g)?.length, 3); // parent + 2 children
  assert.match(ics, /SUMMARY:Read/);
  assert.match(ics, /DTSTART;TZID=Calendizer\/UTC-0700:20260703T222500/);
  assert.doesNotMatch(ics, /^DESCRIPTION:/m);
});

test('DESCRIPTION text is escaped (comma) and long lines are folded', () => {
  const ics = renderICS(
    [inst({ children: [{ subject: 'Stretch, then plank', start: '2026-07-03T22:15', end: '2026-07-03T23:15' }] })],
    'Calendizer',
    -420
  );
  assert.match(ics, /Stretch\\, then plank/); // comma escaped
  // no unfolded content line exceeds 75 octets
  for (const line of ics.split('\r\n')) assert.ok(Buffer.byteLength(line, 'utf8') <= 75, `too long: ${line}`);
});
