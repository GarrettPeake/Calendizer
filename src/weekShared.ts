/**
 * Week-solving helpers shared by the MIP and bubble engines: ISO weekday math,
 * the unsatisfiable-item predicate, the habit (modal start) tracker, the
 * week-to-week template key, and the absolute→day-local obstacle projection.
 * One implementation each — the engines must agree on these semantics.
 */
import { Item, Placement } from './solver';
import { GlobalConfig } from './types';
import { ISODate, absoluteMinutes, weekdayCode } from './time';
import { resolveWindow } from './markers';

/** ISO weekday, Monday = 1 … Sunday = 7. */
export function isoWeekday(d: ISODate): number {
  const idx = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'].indexOf(weekdayCode(d));
  return idx + 1;
}

/** True when the item's floor fits on none of its candidate days (mirrors bestPlacement's terminal case). */
export function isUnsatisfiable(item: Item, config: GlobalConfig): boolean {
  if (item.pinned) return false;
  const grid = Math.max(1, config.grid);
  const floor = item.intent.duration[0];
  const days = item.slot.flexibleDay && item.slot.bucketDates?.length ? item.slot.bucketDates : [item.slot.date];
  for (const date of days) {
    const rw = resolveWindow(item.intent.window, date, config);
    const lo = Math.ceil(rw.notBefore / grid) * grid;
    if (rw.notAfter - floor >= lo) return false;
  }
  return true;
}

/** Habit key: occurrences of one intent at one stack position share a habit. */
export function habitKeyOf(item: Item): string {
  return `${item.slot.intentId}|${item.slot.perDayIndex}`;
}

/** Week-to-week template key: one entry per (intent, stack position, weekday). */
export function templateKeyOf(item: Item, weekday: number): string {
  return `${item.slot.intentId}|${item.slot.perDayIndex}|${weekday}`;
}

/**
 * Habit tracker: modal start per habit key across already-finalized weeks.
 * Weeks must accumulate chronologically (targets reference earlier weeks only).
 */
export interface HabitTracker {
  accumulate(items: Item[]): void;
  targets(): Map<string, number>;
}

export function createHabitTracker(placedByUid: Map<string, Placement>): HabitTracker {
  const counts = new Map<string, Map<number, number>>();
  return {
    accumulate(items: Item[]): void {
      for (const item of items) {
        const p = placedByUid.get(item.slot.uid);
        if (!p || item.pinned) continue;
        const key = habitKeyOf(item);
        const m = counts.get(key) ?? new Map<number, number>();
        m.set(p.startMin, (m.get(p.startMin) ?? 0) + 1);
        counts.set(key, m);
      }
    },
    targets(): Map<string, number> {
      const out = new Map<string, number>();
      for (const [key, byStart] of counts) {
        let best = -1;
        let bestN = 0;
        for (const [start, n] of byStart) {
          if (n > bestN || (n === bestN && start < best)) {
            best = start;
            bestN = n;
          }
        }
        if (bestN > 0) out.set(key, best);
      }
      return out;
    },
  };
}

/** An interval in absolute minutes (from the horizon origin). */
export interface AbsInterval {
  startAbs: number;
  endAbs: number;
  label: string;
}

/** An obstacle in one day's local minutes — may be negative or exceed 1440
 *  (midnight spillover from a neighbouring day). */
export interface DayInterval {
  date: ISODate;
  startMin: number;
  endMin: number;
  label: string;
}

/**
 * Project absolute intervals onto each requested day's local timeline,
 * including spillover from the previous day (an event crossing midnight into
 * this day appears with a negative startMin). Intervals fully inside the
 * previous day are skipped; far-away intervals never appear. Sorted and
 * deduplicated by (date, startMin, endMin).
 */
export function projectToDays(dates: ISODate[], abs: AbsInterval[], origin: ISODate): DayInterval[] {
  const out: DayInterval[] = [];
  const seen = new Set<string>();
  for (const date of [...dates].sort()) {
    const base = absoluteMinutes(origin, date, 0);
    for (const iv of abs) {
      // Anything touching this local day (incl. spillover from the previous day).
      if (iv.endAbs <= base - 1440 || iv.startAbs >= base + 2880) continue;
      if (iv.endAbs <= base && iv.startAbs >= base - 1440) continue; // fully in the previous day
      const startMin = iv.startAbs - base;
      const endMin = iv.endAbs - base;
      if (endMin <= 0 || startMin >= 1600) continue;
      const key = `${date}|${startMin}|${endMin}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ date, startMin, endMin, label: iv.label });
    }
  }
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.startMin - b.startMin || a.endMin - b.endMin));
  return out;
}
