/**
 * Resolution of symbolic time values and per-date windows.
 *
 * The LLM emits symbols (`sunset`) and partial windows; the solver resolves
 * them per date + location into concrete minute bounds. This is the boundary
 * between declarative intent and concrete placement.
 */
import { GlobalConfig, TimeValue, Window, Marker } from './types';
import { ISODate, hhmmToMinutes, weekdayCode } from './time';
import { solarTimes } from './solar';

/** Resolve a single time value to minutes-from-midnight on a date. */
export function resolveTimeValue(
  tv: TimeValue,
  date: ISODate,
  config: GlobalConfig
): number {
  if (typeof tv === 'string') return hhmmToMinutes(tv);

  const offset = tv.offset_min ?? 0;
  const marker: Marker = tv.marker;
  if (marker === 'wakeup') return resolveTimeValue(config.wakeup, date, config) + offset;
  if (marker === 'sleep') return resolveTimeValue(config.sleep, date, config) + offset;

  const solar = solarTimes(date, config.location, config.utcOffsetMinutes ?? 0);
  switch (marker) {
    case 'sunrise':
      return solar.sunrise + offset;
    case 'sunset':
      return solar.sunset + offset;
    case 'dawn':
      return solar.dawn + offset;
    case 'dusk':
      return solar.dusk + offset;
    default:
      throw new Error(`Unknown marker: ${marker}`);
  }
}

export interface ResolvedWindow {
  /** Earliest legal start, minutes from midnight. */
  notBefore: number;
  /** Latest legal end, minutes from midnight. */
  notAfter: number;
  /** Pinned start if specified, else null. */
  startsAt: number | null;
}

const DAY_START = 0;
const DAY_END = 1440;

/**
 * Resolve an intent window for a specific date, applying any weekday overrides.
 * Overrides keyed by comma-joined weekday codes replace matching fields.
 */
export function resolveWindow(
  window: Window,
  date: ISODate,
  config: GlobalConfig
): ResolvedWindow {
  let notBefore = window.not_before;
  let notAfter = window.not_after;
  let startsAt = window.starts_at;

  const wd = weekdayCode(date);
  if (window.overrides) {
    for (const [key, partial] of Object.entries(window.overrides)) {
      const codes = key.split(',').map((c) => c.trim().toUpperCase());
      if (codes.includes(wd)) {
        if (partial.not_before !== undefined) notBefore = partial.not_before;
        if (partial.not_after !== undefined) notAfter = partial.not_after;
        if (partial.starts_at !== undefined) startsAt = partial.starts_at;
      }
    }
  }

  return {
    notBefore: notBefore !== undefined ? resolveTimeValue(notBefore, date, config) : DAY_START,
    notAfter: notAfter !== undefined ? resolveTimeValue(notAfter, date, config) : DAY_END,
    startsAt: startsAt !== undefined ? resolveTimeValue(startsAt, date, config) : null,
  };
}

/** Resolve the nightly sleep blackout as a [start, end] in minutes, possibly wrapping. */
export function resolveSleepBlackout(
  date: ISODate,
  config: GlobalConfig
): { sleepStart: number; wakeStart: number } {
  return {
    sleepStart: resolveTimeValue(config.sleep, date, config),
    wakeStart: resolveTimeValue(config.wakeup, date, config),
  };
}
