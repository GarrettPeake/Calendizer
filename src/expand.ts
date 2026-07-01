/**
 * Expand an intent's cardinality into concrete placement *slots* — the logical
 * occurrences the solver must place. Slot selection is fully deterministic:
 *
 *  - Flexible day counts place the guaranteed FLOOR (min), spread evenly across
 *    the bucket's available days (load-balancing, not collapsed onto adjacent
 *    days). `max` is a weak aspiration not filled in the deterministic MVP.
 *  - `total.max` caps and terminates lifetime occurrences; `total.min` with no
 *    nested day/per_day spec is a flat quota spread across the span.
 *
 * Each slot carries a stable UID keyed to (intent + bucket + index), never to a
 * time, so re-solving updates events in place.
 */
import { Intent, Mode, Cardinality } from './types';
import {
  ISODate,
  isoWeekKey,
  monthKey,
  weekdayCode,
} from './time';
import { activeModeOn, isIntentActiveOn } from './modes';

export interface Slot {
  intentId: string;
  subject: string;
  date: ISODate;
  bucketKey: string;
  /** Index of this occurrence within its (date) for per_day stacking. */
  perDayIndex: number;
  /** Number of occurrences sharing this date (for spread within the day). */
  perDayCount: number;
  uid: string;
  /**
   * True when the day was chosen by the solver (a `days.count` or flat-quota
   * floor) rather than pinned by the user. Such occurrences may spill to another
   * day in `bucketDates` if their chosen day is full, instead of overlapping.
   */
  flexibleDay: boolean;
  /** Candidate days in this slot's bucket, used for spillover. */
  bucketDates?: ISODate[];
  /**
   * An "aspiration" occurrence above the guaranteed floor (fillToMax). It is
   * placed only if a clean, non-overlapping slot exists, and dropped otherwise —
   * never forced and never reported as a conflict.
   */
  optional?: boolean;
}

/** Choose `k` items from a list, spread as evenly as possible. Deterministic. */
export function spreadPick<T>(items: T[], k: number): T[] {
  if (k <= 0 || items.length === 0) return [];
  if (k >= items.length) return [...items];
  const chosen: T[] = [];
  const seen = new Set<number>();
  for (let i = 0; i < k; i++) {
    let idx = Math.round(((i + 0.5) * items.length) / k - 0.5);
    if (idx < 0) idx = 0;
    if (idx >= items.length) idx = items.length - 1;
    while (seen.has(idx) && idx < items.length - 1) idx++;
    while (seen.has(idx) && idx > 0) idx--;
    seen.add(idx);
    chosen.push(items[idx]);
  }
  // Preserve chronological order of the chosen items.
  return items.filter((_, i) => seen.has(i));
}

function bucketKeyFor(date: ISODate, card: Cardinality, intent: Intent, modes: Mode[]): string {
  const unit = card.period?.unit;
  if (unit === 'day') return `day:${date}`;
  if (unit === 'week') return `week:${isoWeekKey(date)}`;
  if (unit === 'month') return `month:${monthKey(date)}`;
  if (unit === 'mode') {
    const active = activeModeOn(date, modes) ?? intent.mode;
    return `mode:${active}`;
  }
  return 'all';
}

/** Apply period.interval by merging consecutive base buckets into groups. */
function mergeIntervalBuckets(orderedKeys: string[], interval: number): Map<string, string> {
  const map = new Map<string, string>();
  if (interval <= 1) {
    for (const k of orderedKeys) map.set(k, k);
    return map;
  }
  orderedKeys.forEach((k, i) => {
    map.set(k, orderedKeys[Math.floor(i / interval) * interval]);
  });
  return map;
}

export function expandIntent(
  intent: Intent,
  horizonDates: ISODate[],
  modes: Mode[],
  fillToMax = false
): Slot[] {
  const intentId = intent.id ?? slugify(intent.subject);
  const card = intent.cardinality;

  // 1. Candidate dates: in horizon AND active for this intent's mode.
  const candidates = horizonDates.filter((d) => isIntentActiveOn(intent, d, modes));
  if (candidates.length === 0) return [];

  // 2. Group candidates into period buckets (with interval merging).
  const baseBuckets = new Map<string, ISODate[]>();
  const orderedBaseKeys: string[] = [];
  for (const d of candidates) {
    const k = bucketKeyFor(d, card, intent, modes);
    if (!baseBuckets.has(k)) {
      baseBuckets.set(k, []);
      orderedBaseKeys.push(k);
    }
    baseBuckets.get(k)!.push(d);
  }
  const intervalMap = mergeIntervalBuckets(orderedBaseKeys, card.period?.interval ?? 1);
  const buckets = new Map<string, ISODate[]>();
  const orderedKeys: string[] = [];
  for (const k of orderedBaseKeys) {
    const merged = intervalMap.get(k)!;
    if (!buckets.has(merged)) {
      buckets.set(merged, []);
      orderedKeys.push(merged);
    }
    buckets.get(merged)!.push(...baseBuckets.get(k)!);
  }

  // Per-day stacking: place the floor (count[0]); when fillToMax is on, band the
  // day by the max (count[1]) and add the extra stacks as optional aspirations.
  const perDayFloor = card.per_day ? card.per_day.count[0] : 1;
  const perDayMax = card.per_day ? card.per_day.count[1] : 1;
  const perDayBand = fillToMax ? Math.max(perDayFloor, perDayMax) : perDayFloor;
  const hasNestedSelection = !!card.days || !!card.per_day;
  const totalMin = card.total?.[0] ?? null;
  const totalMax = card.total?.[1] ?? null;

  const slots: Slot[] = [];

  // A day chosen by a `days.count` selection (or flat quota) is flexible: under
  // contention it may spill to another day in its bucket rather than overlap.
  const isCountDays = !!card.days && 'count' in card.days;

  // Flat quota: no day/per_day selection but a total floor → spread across span.
  if (!hasNestedSelection && totalMin && totalMin > 0) {
    const allDates = candidates;
    const chosen = spreadPick(allDates, totalMin);
    chosen.forEach((date, i) => {
      slots.push(makeSlot(intentId, intent.subject, date, 'span', i, 1, i, true, allDates));
    });
  } else {
    // 3. Per-bucket day selection.
    for (const key of orderedKeys) {
      const days = buckets.get(key)!;
      const chosenDays = chooseDays(days, card);
      let seq = 0; // unique occurrence index within this bucket
      chosenDays.forEach((date) => {
        for (let p = 0; p < perDayBand; p++) {
          const s = makeSlot(intentId, intent.subject, date, key, p, perDayBand, seq++, isCountDays, isCountDays ? days : undefined);
          if (p >= perDayFloor) s.optional = true; // per-day aspiration (fillToMax)
          slots.push(s);
        }
      });

      // fillToMax: add aspiration days toward the count's max, spread across the
      // days the floor didn't claim. They are placed only if a clean slot exists.
      if (fillToMax && isCountDays) {
        const [mn, mx] = (card.days as { count: [number, number] }).count;
        const cap = mx == null ? days.length : mx;
        const extra = cap - Math.max(mn, chosenDays.length);
        if (extra > 0) {
          const remaining = days.filter((d) => !chosenDays.includes(d));
          for (const date of spreadPick(remaining, extra)) {
            for (let p = 0; p < perDayBand; p++) {
              const s = makeSlot(intentId, intent.subject, date, key, p, perDayBand, seq++, true, days);
              s.optional = true;
              slots.push(s);
            }
          }
        }
      }
    }
  }

  // 4. Apply lifetime total cap (max terminates recurrence). Drop aspiration
  // (optional) occurrences before any guaranteed (required) ones.
  let result = slots;
  if (totalMax != null && result.length > totalMax) {
    const required = result.filter((s) => !s.optional);
    const optional = result.filter((s) => s.optional);
    result = required.concat(optional).slice(0, totalMax);
  }
  // Ensure a flat floor is met even when nested selection underfills.
  if (totalMin != null && result.length < totalMin && candidates.length > 0) {
    const extraNeeded = totalMin - result.length;
    const usedDates = new Set(result.map((s) => s.date));
    const free = candidates.filter((d) => !usedDates.has(d));
    const extra = spreadPick(free.length ? free : candidates, extraNeeded);
    extra.forEach((date, i) =>
      result.push(makeSlot(intentId, intent.subject, date, 'floor', i, 1, i, true, candidates))
    );
  }

  return result;
}

function chooseDays(days: ISODate[], card: Cardinality): ISODate[] {
  const spec = card.days;
  if (!spec) {
    // No day spec: one day per bucket if periodic, else every candidate day.
    if (card.per_day && !card.period) return days; // per_day across all days
    if (card.period?.unit === 'day') return days; // bucket is a single date
    if (!card.period) return days;
    return spreadPick(days, 1);
  }
  if ('dates' in spec) return days.filter((d) => spec.dates.includes(d));
  if ('weekdays' in spec) {
    const set = new Set(spec.weekdays.map((w) => w.toUpperCase()));
    return days.filter((d) => set.has(weekdayCode(d)));
  }
  // count: place the guaranteed floor, spread evenly.
  return spreadPick(days, spec.count[0]);
}

function makeSlot(
  intentId: string,
  subject: string,
  date: ISODate,
  bucketKey: string,
  perDayIndex: number,
  perDayCount: number,
  /**
   * Occurrence index WITHIN the bucket, unique across its (day × per_day) slots.
   * The uid keys on this rather than perDayIndex so that multiple occurrences in
   * one week/month/mode bucket don't collide (they'd all be perDayIndex 0). A
   * single-occurrence or daily bucket keeps seq 0, so those uids are unchanged.
   */
  seq: number,
  flexibleDay = false,
  bucketDates?: ISODate[]
): Slot {
  return {
    intentId,
    subject,
    date,
    bucketKey,
    perDayIndex,
    perDayCount,
    uid: `${intentId}|${bucketKey}|${seq}`,
    flexibleDay,
    bucketDates,
  };
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}
