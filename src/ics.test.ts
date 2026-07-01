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

test('children render as TZID-tagged VEVENTs too', () => {
  const ics = renderICS(
    [inst({ children: [{ subject: 'Read', start: '2026-07-03T22:18', end: '2026-07-03T23:30' }] })],
    'Calendizer',
    -420
  );
  assert.match(ics, /SUMMARY:Read/);
  assert.match(ics, /DTSTART;TZID=Calendizer\/UTC-0700:20260703T221800/);
});
