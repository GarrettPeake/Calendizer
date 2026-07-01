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
  addDays,
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
  /** Pinned (starts_at) placements are immovable and never shifted by repair. */
  pinned: boolean;
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

  // Deterministic intent ranking: priority desc, then subject, then id.
  const ordered = [...intents].sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    if (a.subject !== b.subject) return a.subject.localeCompare(b.subject);
    return (a.id ?? '').localeCompare(b.id ?? '');
  });

  // Flatten to (intent, slot) work items. A slot whose window resolves to a
  // pinned start (starts_at) is HARD/immovable; flexible slots can go anywhere
  // in their window. We place all pinned slots FIRST so flexible occurrences —
  // even higher-priority ones — route around the times the user fixed, instead
  // of squatting a slot a pinned event then has no choice but to overlap.
  interface Item {
    intent: Intent;
    slot: Slot;
    pinned: boolean;
    rank: number; // index in `ordered` (encodes priority/subject/id)
  }
  const items: Item[] = [];
  ordered.forEach((intent, rank) => {
    for (const slot of expandIntent(intent, horizonDates, modes, config.fillToMax)) {
      const pinned = resolveWindow(intent.window, slot.date, config).startsAt !== null;
      items.push({ intent, slot, pinned, rank });
    }
  });
  // Placement tiers: pinned (hard) first, then guaranteed (floor), then optional
  // aspiration occurrences last — so extras only claim slots nothing else needs.
  const tierOf = (it: Item) => (it.pinned ? 0 : it.slot.optional ? 2 : 1);
  items.sort((a, b) => {
    const ta = tierOf(a);
    const tb = tierOf(b);
    if (ta !== tb) return ta - tb;
    if (a.rank !== b.rank) return a.rank - b.rank; // then priority/subject/id
    if (a.slot.date !== b.slot.date) return a.slot.date < b.slot.date ? -1 : 1;
    return a.slot.perDayIndex - b.slot.perDayIndex;
  });

  // The immovable seed (fixed events) — obstacles for every phase.
  const fixedOccupied: Occupied[] = occupied.slice();

  // --- Greedy pass: seed each occurrence at its best (min-overlap) slot. ---
  const placements: Placement[] = [];
  for (const { intent, slot, pinned } of items) {
    const bp = bestPlacement(slot, intent, config, occupied, origin);
    // Aspiration (optional) occurrences are placed only when they fit cleanly;
    // otherwise they are silently dropped (never forced, never a conflict).
    if (slot.optional && (bp.unsatisfiable || bp.overlapMin > 0)) continue;
    const placement: Placement = {
      slot,
      intent,
      date: bp.date,
      startMin: bp.startMin,
      durationMin: intent.duration[0],
      placedDuringSleep: bp.placedDuringSleep,
      pinned,
    };
    placements.push(placement);
    occupied.push(occFor(placement, origin));
    if (bp.unsatisfiable) {
      conflicts.push({
        kind: 'window-unsatisfiable',
        message: `Window for "${intent.subject}" on ${slot.date} is too small for its ${placement.durationMin}-minute floor.`,
        involved: [intent.subject],
        date: slot.date,
      });
    }
  }

  // --- Local search: shift flexible occurrences to remove avoidable overlaps
  // (the "shifts and swaps" pass in the contract). Pinned/fixed never move. ---
  repair(placements, fixedOccupied, config, origin);

  // --- fillToMax: grow flexible DURATIONS to fill a contended window, sharing
  // the slack above the floors by priority. ---
  if (config.fillToMax) distributeDurations(placements, fixedOccupied, config, origin);

  // --- Conflict report: name only the overlaps that actually remain, in the
  // same priority order they were placed (pinned first). ---
  conflicts.push(...overlapConflicts(placements, fixedOccupied, origin));

  // Build instances.
  const instances: Instance[] = placements.map((p) => buildInstance(p, config));
  instances.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : a.subject.localeCompare(b.subject)));

  const updates = diffUpdates(instances, existing);

  return { instances, updates, conflicts };
}

/** Occupied interval for a placement, in absolute minutes. */
function occFor(p: Placement, origin: ISODate): Occupied {
  const startAbs = absoluteMinutes(origin, p.date, p.startMin);
  return { startAbs, endAbs: startAbs + p.durationMin, label: p.intent.subject };
}

const DAY_END = 1440;

interface BestPlacement {
  date: ISODate;
  startMin: number;
  placedDuringSleep: boolean;
  /** Total minutes this placement overlaps the supplied obstacles. */
  overlapMin: number;
  /** The window was too small for the duration floor on the chosen day. */
  unsatisfiable: boolean;
}

/**
 * Pure: find the best slot for an occurrence given a set of obstacles. Prefers,
 * in order: a zero-overlap slot (earliest grid-aligned, honouring per_day bands,
 * the sleep blackout, and day spillover) exactly as before; failing that, the
 * minimum-overlap slot anywhere in its window/bucket (so a forced overlap is as
 * small as possible). No side effects — the caller decides whether to use it.
 */
function bestPlacement(
  slot: Slot,
  intent: Intent,
  config: GlobalConfig,
  occupied: Occupied[],
  origin: ISODate
): BestPlacement {
  const durationMin = intent.duration[0];
  const grid = Math.max(1, config.grid);
  const padding = config.padding ?? 0;

  // Pinned start: hard pin wins; immovable on its own day.
  const pinnedWin = resolveWindow(intent.window, slot.date, config);
  if (pinnedWin.startsAt !== null) {
    const start = pinnedWin.startsAt;
    return {
      date: slot.date,
      startMin: start,
      placedDuringSleep: isInSleep(start, durationMin, slot.date, config),
      overlapMin: overlapAt(occupied, origin, slot.date, start, durationMin),
      unsatisfiable: false,
    };
  }

  // Candidate days: the chosen day first; flexible (solver-chosen) days may
  // spill to other bucket days — least-loaded first. A spill never lands on a day
  // this intent already occupies, so `days.count` stays a count of distinct DAYS
  // (the chosen day itself is always allowed, for per_day stacking).
  const dates: ISODate[] = [slot.date];
  if (slot.flexibleDay && slot.bucketDates && slot.bucketDates.length > 1) {
    const ownDays = new Set(
      occupied.filter((o) => o.label === intent.subject).map((o) => addDays(origin, Math.floor(o.startAbs / 1440)))
    );
    const others = slot.bucketDates.filter((d) => d !== slot.date && !ownDays.has(d));
    others.sort((a, b) => loadOn(occupied, origin, a) - loadOn(occupied, origin, b) || (a < b ? -1 : 1));
    dates.push(...others);
  }

  // Phase A — earliest zero-overlap slot (unchanged placement for clean cases).
  for (const date of dates) {
    const win = resolveWindow(intent.window, date, config);
    const lo = ceilTo(win.notBefore, grid);
    const hi = win.notAfter - durationMin;
    if (hi < lo) continue;

    let bandLo = lo;
    let bandHi = hi;
    if (slot.perDayCount > 1) {
      const span = hi - lo;
      bandLo = ceilTo(lo + Math.floor((span * slot.perDayIndex) / slot.perDayCount), grid);
      bandHi = lo + Math.floor((span * (slot.perDayIndex + 1)) / slot.perDayCount);
      if (bandLo > hi) bandLo = lo;
      if (bandHi < bandLo) bandHi = hi;
    }
    const trimmed = trimBySleep(bandLo, bandHi, durationMin, date, config);
    const searchLo = trimmed ? trimmed[0] : bandLo;
    const searchHi = trimmed ? trimmed[1] : bandHi;

    let start = findFreeStart(searchLo, searchHi, durationMin, grid, date, origin, occupied, padding);
    if (start === null) start = findFreeStart(lo, hi, durationMin, grid, date, origin, occupied, padding);
    if (start !== null) {
      return { date, startMin: start, placedDuringSleep: isInSleep(start, durationMin, date, config), overlapMin: 0, unsatisfiable: false };
    }
  }

  // Phase B — no zero-overlap slot exists. Take the minimum-overlap one across
  // every candidate day, scanning the whole legal window.
  let best: BestPlacement | null = null;
  for (const date of dates) {
    const win = resolveWindow(intent.window, date, config);
    const lo = ceilTo(win.notBefore, grid);
    const hi = win.notAfter - durationMin;
    if (hi < lo) continue;
    for (let s = lo; s <= hi; s += grid) {
      const ov = overlapAt(occupied, origin, date, s, durationMin);
      const sleeping = isInSleep(s, durationMin, date, config);
      if (
        best === null ||
        ov < best.overlapMin ||
        (ov === best.overlapMin && !sleeping && best.placedDuringSleep)
      ) {
        best = { date, startMin: s, placedDuringSleep: sleeping, overlapMin: ov, unsatisfiable: false };
        if (ov === 0) break; // can't do better on this date
      }
    }
  }
  if (best) return best;

  // Window too small for the floor on every candidate day → place at the floor
  // start on the chosen day and flag it.
  const win = resolveWindow(intent.window, slot.date, config);
  const start = ceilTo(win.notBefore, grid);
  return {
    date: slot.date,
    startMin: start,
    placedDuringSleep: isInSleep(start, durationMin, slot.date, config),
    overlapMin: overlapAt(occupied, origin, slot.date, start, durationMin),
    unsatisfiable: true,
  };
}

/** Total minutes a candidate [start, start+dur] on a date overlaps obstacles. */
function overlapAt(occupied: Occupied[], origin: ISODate, date: ISODate, start: number, dur: number): number {
  const a = absoluteMinutes(origin, date, start);
  const b = a + dur;
  let total = 0;
  for (const o of occupied) total += Math.max(0, Math.min(b, o.endAbs) - Math.max(a, o.startAbs));
  return total;
}

/**
 * Local-search repair: repeatedly shift any flexible occurrence to a slot that
 * strictly reduces its overlap with everything else. Total overlap is a
 * non-negative integer that drops on every move, so this terminates; the cap is
 * a safety net. Pinned occurrences are never moved.
 */
function repair(placements: Placement[], fixed: Occupied[], config: GlobalConfig, origin: ISODate): void {
  const MAX_PASSES = 64;
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let moved = false;
    for (let i = 0; i < placements.length; i++) {
      const p = placements[i];
      if (p.pinned) continue;
      // Obstacles = fixed events + every other placement.
      const others = fixed.slice();
      for (let j = 0; j < placements.length; j++) if (j !== i) others.push(occFor(placements[j], origin));

      const current = overlapAt(others, origin, p.date, p.startMin, p.durationMin);
      if (current === 0) continue;

      const bp = bestPlacement(p.slot, p.intent, config, others, origin);
      if (bp.overlapMin < current) {
        p.date = bp.date;
        p.startMin = bp.startMin;
        p.placedDuringSleep = bp.placedDuringSleep;
        moved = true;
      }
    }
    if (!moved) break;
  }
}

/**
 * Report the overlaps that remain after repair. Replays placements in their
 * placement order (pinned first, then priority), naming for each the
 * already-placed events it collides with — so a forced overlap names the
 * constraints in tension, while avoidable ones (now resolved) raise nothing.
 */
function overlapConflicts(placements: Placement[], fixed: Occupied[], origin: ISODate): ConflictReport[] {
  const conflicts: ConflictReport[] = [];
  const occupied: Occupied[] = fixed.slice();
  for (const p of placements) {
    const a = absoluteMinutes(origin, p.date, p.startMin);
    const b = a + p.durationMin;
    const hits = occupied.filter((o) => a < o.endAbs && o.startAbs < b);
    if (hits.length > 0) {
      conflicts.push({
        kind: 'overlap',
        message: `"${p.intent.subject}" on ${p.date} overlaps ${hits
          .map((h) => `"${h.label}"`)
          .join(', ')} (no non-overlapping slot in its window).`,
        involved: [p.intent.subject, ...hits.map((h) => h.label)],
        date: p.date,
      });
    }
    occupied.push(occFor(p, origin));
  }
  return conflicts;
}

/** Number of placed occurrences already sitting on a given date. */
function loadOn(occupied: Occupied[], origin: ISODate, date: ISODate): number {
  const base = absoluteMinutes(origin, date, 0);
  let n = 0;
  for (const o of occupied) if (o.startAbs >= base && o.startAbs < base + 1440) n++;
  return n;
}

/**
 * fillToMax for DURATIONS. When two or more flexible-duration occurrences
 * contend for the same window on a day, give each its floor then hand the
 * leftover free time to the higher-priority ones (up to their max) — so a busy
 * hour is filled rather than left partly idle — and re-pack them back-to-back
 * into the window's free gaps. A lone flexible occurrence grows in place to fill
 * the free room after it (see `growInPlace`).
 */
function distributeDurations(placements: Placement[], fixed: Occupied[], config: GlobalConfig, origin: ISODate): void {
  const grid = Math.max(1, config.grid);
  const byDay = new Map<ISODate, Placement[]>();
  for (const p of placements) {
    if (p.intent.duration[1] <= p.intent.duration[0]) continue; // fixed length
    const arr = byDay.get(p.date) ?? [];
    arr.push(p);
    byDay.set(p.date, arr);
  }

  for (const [date, dayFlex] of byDay) {
    // A pinned occurrence keeps its fixed start but may still grow its DURATION;
    // grow it in place first (it then anchors the non-pinned re-pack). Only the
    // non-pinned occurrences are grouped/re-packed (which may move their starts).
    for (const p of dayFlex) if (p.pinned) growInPlace(p, date, placements, fixed, config, origin);
    const flex = dayFlex.filter((p) => !p.pinned);
    if (flex.length === 0) continue;
    const win = new Map<Placement, { nb: number; na: number }>();
    for (const p of flex) {
      const w = resolveWindow(p.intent.window, date, config);
      win.set(p, { nb: w.notBefore, na: w.notAfter });
    }
    // Group occurrences whose windows overlap (chained).
    const sorted = [...flex].sort((a, b) => win.get(a)!.nb - win.get(b)!.nb);
    const groups: Placement[][] = [];
    let cur: Placement[] = [];
    let curEnd = -Infinity;
    for (const p of sorted) {
      const { nb, na } = win.get(p)!;
      if (cur.length && nb < curEnd) {
        cur.push(p);
        curEnd = Math.max(curEnd, na);
      } else {
        if (cur.length) groups.push(cur);
        cur = [p];
        curEnd = na;
      }
    }
    if (cur.length) groups.push(cur);

    for (const group of groups) {
      if (group.length === 1) {
        growInPlace(group[0], date, placements, fixed, config, origin);
        continue;
      }
      const ws = Math.min(...group.map((p) => win.get(p)!.nb));
      const we = Math.max(...group.map((p) => win.get(p)!.na));

      // Obstacles in [ws, we] on this day: fixed events + every placement not in
      // the group (at their current position/duration).
      const dayBase = absoluteMinutes(origin, date, 0);
      const obstacles: Array<[number, number]> = [];
      const clip = (s: number, e: number) => {
        const a = Math.max(s, ws);
        const b = Math.min(e, we);
        if (b > a) obstacles.push([a, b]);
      };
      for (const o of fixed) {
        if (o.endAbs > dayBase && o.startAbs < dayBase + 1440) clip(o.startAbs - dayBase, o.endAbs - dayBase);
      }
      // Treat the sleep blackout as an obstacle so packing prefers waking hours.
      // If this leaves too little room the floors>=capacity guard below yields it.
      const { sleepStart, wakeStart } = resolveSleepBlackout(date, config);
      clip(0, wakeStart);
      clip(sleepStart, DAY_END);
      const inGroup = new Set(group);
      for (const p of placements) {
        if (inGroup.has(p) || p.date !== date) continue;
        clip(p.startMin, p.startMin + p.durationMin);
      }
      const free = freeIntervals(ws, we, obstacles);
      const capacity = free.reduce((acc, [s, e]) => acc + (e - s), 0);

      const floors = group.reduce((acc, p) => acc + p.intent.duration[0], 0);
      if (floors >= capacity) continue; // no slack — leave floors as placed

      // Allocate slack to higher priority first (then subject), up to each max.
      const order = [...group].sort(
        (a, b) => b.intent.priority - a.intent.priority || a.intent.subject.localeCompare(b.intent.subject)
      );
      let slack = capacity - floors;
      const dur = new Map<Placement, number>();
      for (const p of order) {
        const add = Math.min(p.intent.duration[1] - p.intent.duration[0], slack);
        dur.set(p, p.intent.duration[0] + add);
        slack -= add;
      }

      // Re-pack the group, highest priority first, into the free gaps. Each event
      // takes the first gap its FLOOR fits, then grows toward its allotted duration
      // bounded by that gap — so a mid-window obstacle (e.g. an early sunset) just
      // trims the event instead of collapsing it back to the floor.
      let ii = 0;
      let cursor = free.length ? free[0][0] : ws;
      for (const p of order) {
        const target = dur.get(p)!;
        const floor = p.intent.duration[0];
        const { nb, na } = win.get(p)!;
        while (ii < free.length) {
          const s = ceilTo(Math.max(cursor, free[ii][0], nb), grid);
          const gapEnd = Math.min(free[ii][1], na);
          if (s + floor <= gapEnd) {
            const end = Math.floor(Math.min(s + target, gapEnd) / grid) * grid;
            const d = Math.max(floor, end - s);
            p.startMin = s;
            p.durationMin = d;
            p.placedDuringSleep = isInSleep(s, d, date, config);
            cursor = s + d;
            break;
          }
          ii++;
          if (ii < free.length) cursor = free[ii][0];
        }
      }
    }
  }
}

/**
 * Grow a lone flexible occurrence's duration in place (start fixed) to fill the
 * free room after it — up to its max — bounded by its window end, the next
 * obstacle (fixed event or other placement, minus padding), and the evening
 * sleep blackout. Never shrinks and can't create an overlap.
 */
function growInPlace(
  p: Placement,
  date: ISODate,
  placements: Placement[],
  fixed: Occupied[],
  config: GlobalConfig,
  origin: ISODate
): void {
  const padding = config.padding ?? 0;
  const start = p.startMin;
  const w = resolveWindow(p.intent.window, date, config);
  const dayBase = absoluteMinutes(origin, date, 0);

  let limit = w.notAfter; // must end by the window's not_after
  const consider = (obstacleStart: number) => {
    if (obstacleStart > start) limit = Math.min(limit, obstacleStart - padding);
  };
  for (const o of fixed) {
    if (o.endAbs > dayBase && o.startAbs < dayBase + 1440) consider(o.startAbs - dayBase);
  }
  for (const q of placements) {
    if (q === p || q.date !== date) continue;
    consider(q.startMin);
  }
  // Don't grow into the evening blackout unless the event already starts there.
  const { sleepStart } = resolveSleepBlackout(date, config);
  if (start < sleepStart) limit = Math.min(limit, sleepStart);

  // Grow toward the duration max, bounded by the room available. We cap by the
  // exact limit rather than snapping to the grid: starts are grid-aligned but a
  // marker-pinned start (e.g. sunset) isn't, and snapping the end would strand a
  // few minutes below the max the user asked for.
  const newDur = Math.min(p.intent.duration[1], limit - start);
  if (newDur > p.durationMin) {
    p.durationMin = newDur;
    p.placedDuringSleep = isInSleep(start, newDur, date, config);
  }
}

/** Free [start,end] gaps inside [ws,we] once the obstacles are removed. */
function freeIntervals(ws: number, we: number, obstacles: Array<[number, number]>): Array<[number, number]> {
  const sorted = [...obstacles].sort((a, b) => a[0] - b[0]);
  const out: Array<[number, number]> = [];
  let cursor = ws;
  for (const [s, e] of sorted) {
    if (s > cursor) out.push([cursor, Math.min(s, we)]);
    cursor = Math.max(cursor, e);
    if (cursor >= we) break;
  }
  if (cursor < we) out.push([cursor, we]);
  return out;
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
