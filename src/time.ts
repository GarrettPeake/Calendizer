/**
 * Pure date/time helpers. The solver works in "minutes from local midnight"
 * on a given calendar date; this module converts to/from ISO strings and does
 * date arithmetic without depending on the host timezone.
 */
import { ISODate, ISODateTime } from './types';
export type { ISODate, ISODateTime } from './types';

const MS_PER_DAY = 86_400_000;

/** Parse `YYYY-MM-DD` into a UTC-anchored Date (no host-tz drift). */
export function parseDate(d: ISODate): Date {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, day));
}

export function formatDate(dt: Date): ISODate {
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Add `n` whole days to an ISO date. */
export function addDays(d: ISODate, n: number): ISODate {
  const dt = parseDate(d);
  return formatDate(new Date(dt.getTime() + n * MS_PER_DAY));
}

/** Inclusive number of days from a to b. */
export function daysBetween(a: ISODate, b: ISODate): number {
  return Math.round((parseDate(b).getTime() - parseDate(a).getTime()) / MS_PER_DAY);
}

/** Inclusive list of dates from start to end. */
export function dateRange(start: ISODate, end: ISODate): ISODate[] {
  const out: ISODate[] = [];
  let cur = start;
  while (cur <= end) {
    out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}

const WEEKDAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

/** Weekday code (`MO`, `TU`, ...) for an ISO date. */
export function weekdayCode(d: ISODate): string {
  return WEEKDAY_CODES[parseDate(d).getUTCDay()];
}

/** Monday-based ISO week key, e.g. "2026-W27", used to bucket weeks. */
export function isoWeekKey(d: ISODate): string {
  const dt = parseDate(d);
  const day = (dt.getUTCDay() + 6) % 7; // 0 = Monday
  const thursday = new Date(dt.getTime() + (3 - day) * MS_PER_DAY);
  const year = thursday.getUTCFullYear();
  const jan1 = new Date(Date.UTC(year, 0, 1));
  const week = Math.floor((thursday.getTime() - jan1.getTime()) / MS_PER_DAY / 7) + 1;
  return `${year}-W${String(week).padStart(2, '0')}`;
}

export function monthKey(d: ISODate): string {
  return d.slice(0, 7);
}

/** Minutes-from-midnight → `HH:MM`. Clamps within a single day for display. */
export function minutesToHHMM(min: number): string {
  const m = ((min % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/** `HH:MM` → minutes from midnight. */
export function hhmmToMinutes(s: string): number {
  const [h, m] = s.split(':').map(Number);
  return h * 60 + m;
}

/** Combine a date with minutes-from-midnight into an ISO local date-time. */
export function toISODateTime(date: ISODate, minutes: number): ISODateTime {
  const dayOffset = Math.floor(minutes / 1440);
  const baseDate = dayOffset !== 0 ? addDays(date, dayOffset) : date;
  return `${baseDate}T${minutesToHHMM(minutes)}`;
}

/** Split an ISO date-time back into its date and minutes-from-midnight. */
export function fromISODateTime(dt: ISODateTime): { date: ISODate; minutes: number } {
  const [date, time] = dt.split('T');
  return { date, minutes: hhmmToMinutes(time) };
}

/** Absolute minute index across the horizon (date midnight as origin). */
export function absoluteMinutes(origin: ISODate, date: ISODate, minutes: number): number {
  return daysBetween(origin, date) * 1440 + minutes;
}
