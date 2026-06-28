// Lightweight, UTC-anchored date helpers for the week view (mirrors the
// library's own convention so dates line up exactly with the solver).

const MS = 86_400_000;

export function parse(d: string): Date {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, day));
}

export function fmt(dt: Date): string {
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDays(d: string, n: number): string {
  return fmt(new Date(parse(d).getTime() + n * MS));
}

/** Monday on or before the given date. */
export function mondayOf(d: string): string {
  const dt = parse(d);
  const dow = (dt.getUTCDay() + 6) % 7; // 0 = Monday
  return fmt(new Date(dt.getTime() - dow * MS));
}

export const WEEKDAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

export function weekdayCode(d: string): string {
  return WEEKDAY_CODES[parse(d).getUTCDay()];
}

export function weekDates(monday: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function dayLabel(d: string): { dow: string; day: number; month: string } {
  const dt = parse(d);
  return { dow: DOW[dt.getUTCDay()], day: dt.getUTCDate(), month: MONTHS[dt.getUTCMonth()] };
}

export function rangeLabel(start: string, end: string): string {
  const a = parse(start);
  const b = parse(end);
  const aS = `${MONTHS[a.getUTCMonth()]} ${a.getUTCDate()}`;
  const bS =
    a.getUTCMonth() === b.getUTCMonth()
      ? `${b.getUTCDate()}`
      : `${MONTHS[b.getUTCMonth()]} ${b.getUTCDate()}`;
  return `${aS} – ${bS}, ${b.getUTCFullYear()}`;
}

export function hhmmToMin(s: string): number {
  const [h, m] = s.split(':').map(Number);
  return h * 60 + m;
}

/** Minutes-from-midnight of an ISO date-time's clock part. */
export function timeOfMin(iso: string): number {
  return hhmmToMin(iso.split('T')[1]);
}

export function dateOf(iso: string): string {
  return iso.split('T')[0];
}
