/**
 * Temporal-stability helpers (pure). These live in the library so they're unit-
 * testable without D1, but they are consumed only by the API layer — the solver
 * itself stays time-agnostic and deterministic.
 *
 * The model: the calendar is `frozen_past ⊕ solved_future`. We solve whole,
 * period-aligned buckets so cardinality spreads naturally, then overlay the
 * immutable frozen past over the projected past (see `overlay`).
 */
import { Instance, Intent, Mode } from './types';
import { ISODate, dateRange, startOfISOWeek, startOfMonth } from './time';
import { expandIntent } from './expand';

/**
 * The solve horizon must start on a natural period boundary so week/month
 * buckets are whole (otherwise the current, partially-elapsed bucket is
 * truncated and cardinality math is wrong). Take the earliest of the current
 * ISO-week start and month start.
 */
export function alignHorizonStart(today: ISODate): ISODate {
  const wk = startOfISOWeek(today);
  const mo = startOfMonth(today);
  return wk < mo ? wk : mo;
}

/**
 * Merge the immutable frozen past with a fresh projection:
 *   output = frozen ∪ { p ∈ projected : p.start >= now AND p.uid ∉ frozen.uids }
 * Frozen entries win on a uid tie; projected placements before `now` are dropped
 * (they either already happened — and are represented by a frozen row — or, for a
 * newly added intent, never happened and can't be scheduled into the past).
 */
export function overlay(frozen: Instance[], projected: Instance[], nowDT: string): Instance[] {
  const frozenUids = new Set(frozen.map((f) => f.uid));
  const out: Instance[] = [...frozen];
  for (const p of projected) {
    if (p.start < nowDT) continue;
    if (frozenUids.has(p.uid)) continue;
    out.push(p);
  }
  out.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : a.subject.localeCompare(b.subject)));
  return out;
}

/**
 * True when an intent can produce no further occurrences within [today, end] —
 * e.g. a one-off dated event whose date has passed, or a mode-bound intent whose
 * mode has ended. Such intents are reaped (deleted); their already-happened
 * occurrences persist as frozen history, decoupled from the live intent.
 *
 * Uses the real expansion over the future window so day/date/mode specs are all
 * honoured (a bare mode check would miss a past-dated `days.dates` intent).
 */
export function isFullyPassed(intent: Intent, modes: Mode[], today: ISODate, end: ISODate): boolean {
  if (today > end) return true;
  const futureDates = dateRange(today, end);
  return expandIntent(intent, futureDates, modes, false).length === 0;
}
