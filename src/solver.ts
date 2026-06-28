/**
 * The deterministic solver.
 *
 * Contract (from the schema):
 *  - ALWAYS places. Never returns "infeasible"; when forced it overlaps and
 *    reports the specific constraints in tension.
 *  - Hard constraints: the resolved window (incl. overrides), the duration
 *    floor, and the children tiling invariants.
 *  - Soft constraints: non-overlap, spread of an intent's repetitions, grid
 *    rounding, priority-weighted compromise.
 *  - Sleep yields to necessity: the blackout is intersected into each intent's
 *    window only while that leaves it non-empty; if the only legal slot is
 *    inside sleep, sleep is dropped and NO conflict is reported.
 *
 * Placement strategy (MVP, fully deterministic):
 *  - Duration is the guaranteed floor (`duration[0]`); `max` is a weak,
 *    diminishing aspiration not filled in the MVP.
 *  - An intent's repetitions are spread across days (in expansion) and across
 *    the waking day (per_day banding) for even distribution and regularity.
 *  - Within its band each occurrence takes the EARLIEST grid-aligned start that
 *    is free of overlap (respecting padding), which yields compact, habitual,
 *    re-solve-stable placements. Window-centering is a later refinement.
 */
import {
  GlobalConfig,
  Intent,
  Mode,
  CalendarEvent,
  Instance,
  ConflictReport,
  SolveInput,
  SolveOutput,
  Update,
} from './types';
import {
  ISODate,
  dateRange,
  toISODateTime,
  fromISODateTime,
  absoluteMinutes,
} from './time';
import { resolveWindow, resolveSleepBlackout } from './markers';
import { detectModeOverlaps } from './modes';
import { expandIntent, Slot, slugify } from './expand';
import { tileChildren } from './children';

interface Occupied {
  startAbs: number;
  endAbs: number;
  label: string; // subject or uid for conflict reporting
}

interface Placement {
  slot: Slot;
  intent: Intent;
  date: ISODate;
  startMin: number;
  durationMin: number;
  placedDuringSleep: boolean;
}

export function solve(input: SolveInput): SolveOutput {
  const { config, intents } = input;
  const modes = input.modes ?? [];
  const existing = input.existingCalendar ?? [];
  const horizonDates = dateRange(input.horizon.start, input.horizon.end);
  const origin = input.horizon.start;

  const conflicts: ConflictReport[] = [];
  conflicts.push(...detectModeOverlaps(modes));

  // Seed occupancy with existing FIXED events (no intentId ⇒ immovable input).
  const occupied: Occupied[] = [];
  for (const ev of existing) {
    if (ev.intentId) continue; // derived events are re-placed, not obstacles
    const s = fromISODateTime(ev.start);
    const e = fromISODateTime(ev.end);
    occupied.push({
      startAbs: absoluteMinutes(origin, s.date, s.minutes),
      endAbs: absoluteMinutes(origin, e.date, e.minutes),
      label: ev.subject,
    });
  }

  // Deterministic processing order: priority desc, then subject, then id.
  const ordered = [...intents].sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    if (a.subject !== b.subject) return a.subject.localeCompare(b.subject);
    return (a.id ?? '').localeCompare(b.id ?? '');
  });

  const placements: Placement[] = [];

  for (const intent of ordered) {
    const slots = expandIntent(intent, horizonDates, modes);
    // Group slots by date to band per_day occurrences.
    for (const slot of slots) {
      const placement = placeSlot(slot, intent, config, occupied, origin, conflicts);
      if (placement) {
        placements.push(placement);
        const dur = placement.durationMin;
        const startAbs = absoluteMinutes(origin, placement.date, placement.startMin);
        occupied.push({
          startAbs,
          endAbs: startAbs + dur,
          label: intent.subject,
        });
      }
    }
  }

  // Build instances.
  const instances: Instance[] = placements.map((p) => buildInstance(p, config));
  instances.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : a.subject.localeCompare(b.subject)));

  const updates = diffUpdates(instances, existing);

  return { instances, updates, conflicts };
}

const DAY_END = 1440;

function placeSlot(
  slot: Slot,
  intent: Intent,
  config: GlobalConfig,
  occupied: Occupied[],
  origin: ISODate,
  conflicts: ConflictReport[]
): Placement {
  const date = slot.date;
  const durationMin = intent.duration[0];
  const win = resolveWindow(intent.window, date, config);
  const grid = Math.max(1, config.grid);

  // Pinned start: hard pin wins (used for fixed/flexible-with-starts_at).
  if (win.startsAt !== null) {
    const start = win.startsAt;
    const placedDuringSleep = isInSleep(start, durationMin, date, config);
    registerOverlapConflict(slot, intent, start, durationMin, date, origin, occupied, conflicts);
    return { slot, intent, date, startMin: start, durationMin, placedDuringSleep };
  }

  // Legal start range for the duration floor.
  let lo = ceilTo(win.notBefore, grid);
  let hi = win.notAfter - durationMin;

  if (hi < lo) {
    // Window too small for the duration floor — hard constraints in tension.
    conflicts.push({
      kind: 'window-unsatisfiable',
      message: `Window for "${intent.subject}" on ${date} is too small for its ${durationMin}-minute floor (${win.notBefore}–${win.notAfter} min).`,
      involved: [intent.subject],
      date,
    });
    const start = ceilTo(win.notBefore, grid);
    registerOverlapConflict(slot, intent, start, durationMin, date, origin, occupied, conflicts);
    return { slot, intent, date, startMin: start, durationMin, placedDuringSleep: isInSleep(start, durationMin, date, config) };
  }

  // Band the legal range for per_day spread across the waking day.
  let bandLo = lo;
  let bandHi = hi;
  if (slot.perDayCount > 1) {
    const span = hi - lo;
    bandLo = ceilTo(lo + Math.floor((span * slot.perDayIndex) / slot.perDayCount), grid);
    bandHi = lo + Math.floor((span * (slot.perDayIndex + 1)) / slot.perDayCount);
    if (bandLo > hi) bandLo = lo;
    if (bandHi < bandLo) bandHi = hi;
  }

  // Sleep yielding: trim the band by the sleep blackout if that leaves room.
  const trimmed = trimBySleep(bandLo, bandHi, durationMin, date, config);
  const searchLo = trimmed ? trimmed[0] : bandLo;
  const searchHi = trimmed ? trimmed[1] : bandHi;

  // Earliest grid-aligned, overlap-free start within the band; then the window.
  const padding = config.padding ?? 0;
  let start = findFreeStart(searchLo, searchHi, durationMin, grid, date, origin, occupied, padding);
  if (start === null) start = findFreeStart(lo, hi, durationMin, grid, date, origin, occupied, padding);

  if (start === null) {
    // Forced to overlap: place at band start and report.
    start = ceilTo(bandLo, grid);
    registerOverlapConflict(slot, intent, start, durationMin, date, origin, occupied, conflicts);
  }

  const placedDuringSleep = isInSleep(start, durationMin, date, config);
  return { slot, intent, date, startMin: start, durationMin, placedDuringSleep };
}

/** Subtract the nightly sleep blackout from [lo, hi]; null when no trim needed. */
function trimBySleep(
  lo: number,
  hi: number,
  duration: number,
  date: ISODate,
  config: GlobalConfig
): [number, number] | null {
  const { sleepStart, wakeStart } = resolveSleepBlackout(date, config);
  // Blackout within a day: [0, wakeStart) and [sleepStart, 1440).
  // Keep the window inside waking hours if a floor-length slot still fits.
  const candLo = Math.max(lo, wakeStart);
  const candHi = Math.min(hi, sleepStart - duration);
  if (candHi >= candLo && candHi >= 0 && candLo <= DAY_END) {
    return [candLo, candHi];
  }
  return null; // sleep yields: keep the original (discretion impossible)
}

function isInSleep(start: number, duration: number, date: ISODate, config: GlobalConfig): boolean {
  const { sleepStart, wakeStart } = resolveSleepBlackout(date, config);
  const end = start + duration;
  // Overlaps morning blackout [0, wakeStart) or evening [sleepStart, 1440+).
  if (start < wakeStart) return true;
  if (end > sleepStart) return true;
  return false;
}

function findFreeStart(
  lo: number,
  hi: number,
  duration: number,
  grid: number,
  date: ISODate,
  origin: ISODate,
  occupied: Occupied[],
  padding: number
): number | null {
  let s = ceilTo(lo, grid);
  while (s <= hi) {
    const startAbs = absoluteMinutes(origin, date, s);
    if (!overlapsAny(startAbs, startAbs + duration, occupied, padding)) {
      return s;
    }
    s += grid;
  }
  return null;
}

function overlapsAny(
  startAbs: number,
  endAbs: number,
  occupied: Occupied[],
  padding: number
): boolean {
  for (const o of occupied) {
    if (startAbs < o.endAbs + padding && o.startAbs < endAbs + padding) return true;
  }
  return false;
}

function registerOverlapConflict(
  slot: Slot,
  intent: Intent,
  start: number,
  duration: number,
  date: ISODate,
  origin: ISODate,
  occupied: Occupied[],
  conflicts: ConflictReport[]
): void {
  const startAbs = absoluteMinutes(origin, date, start);
  const endAbs = startAbs + duration;
  const padding = 0;
  const hits = occupied.filter(
    (o) => startAbs < o.endAbs + padding && o.startAbs < endAbs + padding
  );
  if (hits.length > 0) {
    conflicts.push({
      kind: 'overlap',
      message: `"${intent.subject}" on ${date} overlaps ${hits
        .map((h) => `"${h.label}"`)
        .join(', ')} (no non-overlapping slot in its window).`,
      involved: [intent.subject, ...hits.map((h) => h.label)],
      date,
    });
  }
}

function buildInstance(p: Placement, config: GlobalConfig): Instance {
  const start = toISODateTime(p.date, p.startMin);
  const end = toISODateTime(p.date, p.startMin + p.durationMin);
  const instance: Instance = {
    uid: p.slot.uid,
    intentId: p.intent.id ?? slugify(p.intent.subject),
    subject: p.intent.subject,
    date: p.date,
    start,
    end,
    durationMin: p.durationMin,
  };
  if (p.placedDuringSleep) instance.placedDuringSleep = true;
  if (p.intent.children && p.intent.children.length > 0) {
    const tiles = tileChildren(p.startMin, p.durationMin, p.intent.children);
    instance.children = tiles.map((t) => ({
      subject: t.subject,
      start: toISODateTime(p.date, t.startMin),
      end: toISODateTime(p.date, t.endMin),
    }));
  }
  return instance;
}

/** Compute the create/update/delete/unchanged set against the prior calendar. */
function diffUpdates(instances: Instance[], existing: CalendarEvent[]): Update[] {
  const updates: Update[] = [];
  const prevByUid = new Map<string, CalendarEvent>();
  for (const ev of existing) {
    if (ev.intentId) prevByUid.set(ev.uid, ev);
  }
  const newUids = new Set<string>();

  for (const inst of instances) {
    newUids.add(inst.uid);
    const prev = prevByUid.get(inst.uid);
    if (!prev) {
      updates.push({ kind: 'create', uid: inst.uid, instance: inst });
    } else if (prev.start === inst.start && prev.end === inst.end && prev.subject === inst.subject) {
      updates.push({ kind: 'unchanged', uid: inst.uid, instance: inst, previous: prev });
    } else {
      updates.push({ kind: 'update', uid: inst.uid, instance: inst, previous: prev });
    }
  }
  for (const [uid, prev] of prevByUid) {
    if (!newUids.has(uid)) {
      updates.push({ kind: 'delete', uid, previous: prev });
    }
  }
  return updates;
}

function ceilTo(value: number, step: number): number {
  return Math.ceil(value / step) * step;
}
