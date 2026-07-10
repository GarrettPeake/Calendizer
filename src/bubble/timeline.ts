/**
 * Day timelines for the bubble solver: per-date obstacle lists (everything
 * outside the model set, projected to day-local minutes — spillover included,
 * never clamped) and Item → ReflowBubble construction (window resolution per
 * date, per_day band starts, sleep trimming, pin anchors).
 */
import { Item, Placement, Construction, occFor, trimBySleep, ceilTo } from '../solver';
import { GlobalConfig } from '../types';
import { ISODate } from '../time';
import { resolveWindow, resolveSleepBlackout } from '../markers';
import { projectToDays } from '../weekShared';
import { ReflowBubble } from './reflow';

/**
 * Obstacles per date: fixed calendar events plus every placement NOT in the
 * model set, at its current position (frozen pins, unsatisfiables, adjacent
 * weeks, past days — all placements too). Sorted by start per date.
 */
export function dayObstacles(
  dates: ISODate[],
  placedByUid: Map<string, Placement>,
  modelUids: ReadonlySet<string>,
  c: Construction
): Map<ISODate, Array<[number, number]>> {
  const abs: Array<{ startAbs: number; endAbs: number; label: string }> = [];
  for (const f of c.fixedOccupied) abs.push(f);
  for (const p of placedByUid.values()) {
    if (modelUids.has(p.slot.uid)) continue;
    abs.push(occFor(p, c.origin));
  }
  const out = new Map<ISODate, Array<[number, number]>>();
  for (const date of dates) out.set(date, []);
  for (const iv of projectToDays(dates, abs, c.origin)) {
    out.get(iv.date)!.push([iv.startMin, iv.endMin]);
  }
  return out;
}

/**
 * The reflow bubble for `item` scheduled on `date`, or null when the window
 * cannot legally hold the floor there at all. Mirrors bestPlacement's
 * semantics: pins anchor and bypass sleep trimming; per_day stacks start at
 * their band; sleep trims the start range when a waking floor fits (the end
 * then caps at bedtime so growth can't creep into sleep), and yields
 * otherwise (a forced sleep placement is flagged, never blocked).
 */
export function bubbleFor(item: Item, date: ISODate, config: GlobalConfig): ReflowBubble | null {
  const rw = resolveWindow(item.intent.window, date, config);
  const grid = Math.max(1, config.grid);
  const floor = item.intent.duration[0];
  const max = config.fillToMax ? Math.max(floor, item.intent.duration[1]) : floor;
  const weight = (item.intent.priority ?? 0) + 1;

  if (rw.startsAt !== null) {
    if (rw.startsAt + floor > rw.notAfter) return null;
    return { floor, max, notBefore: rw.startsAt, notAfter: rw.notAfter, startsAt: rw.startsAt, endsAt: null, weight };
  }
  if (rw.endsAt !== null) {
    if (rw.endsAt - floor < rw.notBefore) return null;
    return { floor, max, notBefore: rw.notBefore, notAfter: rw.endsAt, startsAt: null, endsAt: rw.endsAt, weight };
  }

  const lo = ceilTo(rw.notBefore, grid);
  const hi = rw.notAfter - floor;
  if (hi < lo) return null;

  // Per_day stacks start at their band so same-day siblings spread.
  let bandLo = lo;
  if (item.slot.perDayCount > 1) {
    const span = hi - lo;
    bandLo = ceilTo(lo + Math.floor((span * item.slot.perDayIndex) / item.slot.perDayCount), grid);
    if (bandLo > hi) bandLo = lo;
  }

  const trimmed = trimBySleep(bandLo, hi, floor, date, config);
  const notBefore = trimmed ? trimmed[0] : bandLo;
  const notAfter = trimmed ? Math.min(rw.notAfter, resolveSleepBlackout(date, config).sleepStart) : rw.notAfter;
  return { floor, max, notBefore, notAfter, startsAt: null, endsAt: null, weight };
}
