/**
 * The MIP solver: greedy seed + per-ISO-week lexicographic MIP re-solve.
 *
 *   1. Run the full greedy pipeline (construction + repair + duration fill).
 *   2. Walk the weeks chronologically. A week whose seed is already
 *      contention-free (no raw overlap, no discretionary sleep placement, no
 *      padding shortfall, no dropped optionals, no unfilled flexible duration)
 *      keeps its greedy arrangement verbatim — byte-stable clean weeks.
 *   3. A contended week is rebuilt as a small MIP (src/milp/lp.ts) and solved
 *      through lexicographic objective stages (src/milp/stages.ts):
 *      overlap → sleep → padding → optionals → durations → habit → earliness.
 *      Identical week models are memoized (a weekly-periodic schedule solves
 *      one model, not fifty-three).
 *   4. Any stage failure falls back to the greedy seed for that week —
 *      deterministic, never worse than today.
 *
 * Day mobility is granted to "hot" occurrences (those participating in the
 * contention) over `bucketDates ∩ week`; cold occurrences stay on their day
 * but may still move in time. Pinned fixed-duration and window-unsatisfiable
 * placements are frozen as constant obstacles (they carry their construction
 * conflicts through unchanged).
 */
import {
  Solver,
  Construction,
  Item,
  Placement,
  greedyPlacements,
  assembleOutput,
  isInSleep,
  occFor,
} from '../solver';
import { GlobalConfig, SolveInput, SolveOutput } from '../types';
import { ISODate, isoWeekKey, absoluteMinutes, startOfISOWeek, addDays, weekdayCode } from '../time';
import { resolveWindow, resolveSleepBlackout } from '../markers';
import { buildWeekModel, DayObstacle, WeekOccurrence, WeekModel } from './lp';
import { HighsInstance, runStages, StageTrace } from './stages';

/** Optional hook so tooling (scripts/solve-debug) can capture per-week traces. */
export interface MilpDebugSink {
  onWeek?(weekKey: string, info: { skipped: boolean; fallback?: boolean; memo?: boolean; trace?: StageTrace[] }): void;
}

export function createMilpSolver(highs: HighsInstance, debug?: MilpDebugSink): Solver {
  return {
    solve(input: SolveInput): SolveOutput {
      const c = greedyPlacements(input);
      solveWeeks(highs, c, input, debug);
      return assembleOutput(c, input);
    },
  };
}

/** Model-size safety valve: beyond this many rows, keep the greedy week. */
const MAX_ROWS = 30000;

function solveWeeks(highs: HighsInstance, c: Construction, input: SolveInput, debug?: MilpDebugSink): void {
  const config = input.config;
  const placedByUid = new Map<string, Placement>(c.placements.map((p) => [p.slot.uid, p]));
  const droppedUids = new Set(c.dropped.map((i) => i.slot.uid));

  // Group items by ISO week of their slot date.
  const weeks = new Map<string, Item[]>();
  for (const item of c.items) {
    const wk = isoWeekKey(item.slot.date);
    const arr = weeks.get(wk) ?? [];
    arr.push(item);
    weeks.set(wk, arr);
  }
  const weekKeys = [...weeks.keys()].sort();

  // Habit: modal start per (intentId, perDayIndex) across already-final weeks.
  const habitCounts = new Map<string, Map<number, number>>();
  const accumulateHabit = (items: Item[]) => {
    for (const item of items) {
      const p = placedByUid.get(item.slot.uid);
      if (!p || item.pinned) continue;
      const key = `${item.slot.intentId}|${item.slot.perDayIndex}`;
      const m = habitCounts.get(key) ?? new Map<number, number>();
      m.set(p.startMin, (m.get(p.startMin) ?? 0) + 1);
      habitCounts.set(key, m);
    }
  };
  const habitTargets = (): Map<string, number> => {
    const out = new Map<string, number>();
    for (const [key, counts] of habitCounts) {
      let best = -1;
      let bestN = 0;
      for (const [start, n] of counts) {
        if (n > bestN || (n === bestN && start < best)) {
          best = start;
          bestN = n;
        }
      }
      if (bestN > 0) out.set(key, best);
    }
    return out;
  };

  // Memo: identical week models (weekly-periodic schedules) solve once.
  const memo = new Map<string, Map<string, number> | null>();

  // Week-to-week solution translation: the previous week's solved arrangement,
  // keyed by (intentId, perDayIndex, weekday), proposed as this week's seed.
  // When the proposal is still legal (windows drift with solar markers) and no
  // worse than the greedy seed, the week inherits it — a periodic year then
  // costs one hard solve plus cheap verifications, and habits stay put.
  const template = new Map<string, { weekday: number; startMin: number; durationMin: number } | null>();
  const templateKey = (item: Item, weekday: number) => `${item.slot.intentId}|${item.slot.perDayIndex}|${weekday}`;

  for (const wk of weekKeys) {
    const items = weeks.get(wk)!;
    const adoption = tryAdoptTemplate(items, template, templateKey, placedByUid, c, config);
    const seed = analyzeWeek(items, placedByUid, droppedUids, c, config, adoption);
    const recordTemplate = () => {
      for (const item of items) {
        const p = placedByUid.get(item.slot.uid);
        const wd = isoWeekday(item.slot.date);
        template.set(templateKey(item, wd), p ? { weekday: isoWeekday(p.date), startMin: p.startMin, durationMin: p.durationMin } : null);
      }
    };
    if (!seed.needsMip) {
      debug?.onWeek?.(wk, { skipped: true });
      recordTemplate();
      accumulateHabit(items);
      continue;
    }

    const weekTrace: StageTrace[] = [];
    let anyMemo = false;
    let anyFallback = false;

    // Runs one model through memo + stages and applies its solution. Returns
    // false when the seed was kept (ideal/failed/capped-no-better).
    const runModel = (model: ReturnType<typeof buildWeekModel>, occ: WeekOccurrence[], label: string): boolean => {
      if (model.constraints.length > MAX_ROWS) {
        anyFallback = true;
        return false;
      }
      const key = memoKey(model);
      let values = memo.get(key);
      if (values !== undefined) {
        anyMemo = true;
      } else {
        const res = runStages(highs, model);
        values = res.values;
        memo.set(key, values);
        for (const t of res.trace) weekTrace.push({ ...t, name: `${label}:${t.name}` });
      }
      if (values === null) return false;
      applySolution(model, occ, values, placedByUid, config);
      return true;
    };

    // ---- Phase A: the joint contention model (day assignment). Runs only on
    // real contention; growth-only weeks go straight to per-day packing. ----
    if (seed.contention) {
      const occA = buildOccurrences(seed, wk, placedByUid, config);
      if (occA.length > 0) {
        const obstaclesA = buildObstacles(occA, placedByUid, c);
        runModel(buildWeekModel({ occ: occA, obstacles: obstaclesA, config, habit: new Map(), phase: 'week' }), occA, 'A');
      }
    }

    // ---- Phase B: per-day packing at the (now fixed) day assignment. ----
    const byDate = new Map<ISODate, Item[]>();
    for (const item of seed.movable) {
      const p = placedByUid.get(item.slot.uid);
      if (!p) continue; // optionals phase A left unplaced stay out
      const arr = byDate.get(p.date) ?? [];
      arr.push(item);
      byDate.set(p.date, arr);
    }
    const habit = habitTargets();
    for (const date of [...byDate.keys()].sort()) {
      const occB: WeekOccurrence[] = byDate.get(date)!.map((item) => {
        const p = placedByUid.get(item.slot.uid)!;
        return {
          item,
          days: [date],
          seed: { date: p.date, startMin: p.startMin, durationMin: p.durationMin },
          forceRequired: true,
        };
      });
      const obstaclesB = buildObstacles(occB, placedByUid, c);
      runModel(buildWeekModel({ occ: occB, obstacles: obstaclesB, config, habit, phase: 'day' }), occB, date.slice(5));
    }

    debug?.onWeek?.(wk, { skipped: false, fallback: anyFallback, memo: anyMemo, trace: weekTrace });
    recordTemplate();
    accumulateHabit(items);
  }

  // Rebuild placements in canonical item order from the final arrangement.
  c.placements = c.items
    .map((i) => placedByUid.get(i.slot.uid))
    .filter((p): p is Placement => !!p);
}

interface WeekSeed {
  items: Item[];
  /** Items entering the model (movable), in canonical order. */
  movable: Item[];
  /** Movable items that are contention-involved → get day mobility. */
  hot: Set<string>; // uid
  /** Items frozen as constant obstacles (pinned fixed-duration, unsatisfiable). */
  frozen: Item[];
  /** Any reason to run MIP at all (contention OR unfilled growth). */
  needsMip: boolean;
  /** Real contention (overlap/sleep/padding/unresolved drops) → phase A runs. */
  contention: boolean;
}

/** ISO weekday, Monday = 1 … Sunday = 7. */
function isoWeekday(d: ISODate): number {
  const idx = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'].indexOf(weekdayCode(d));
  return idx + 1;
}

function analyzeWeek(
  items: Item[],
  placedByUid: Map<string, Placement>,
  droppedUids: Set<string>,
  c: Construction,
  config: GlobalConfig,
  adoption: { adopted: boolean; adoptedDrops: Set<string> }
): WeekSeed {
  const { adopted, adoptedDrops } = adoption;
  const padding = config.padding ?? 0;
  const movable: Item[] = [];
  const frozen: Item[] = [];
  const hot = new Set<string>();
  let needsMip = false;
  let contention = false;

  const flexDur = (i: Item) => !!config.fillToMax && i.intent.duration[1] > i.intent.duration[0];

  for (const item of items) {
    const p = placedByUid.get(item.slot.uid);
    if (!p) {
      if (droppedUids.has(item.slot.uid) || adoptedDrops.has(item.slot.uid)) {
        // An unplaced aspiration: a candidate whenever phase A runs; a TRIGGER
        // only when the drop wasn't inherited from the adopted week template.
        movable.push(item);
        hot.add(item.slot.uid);
        if (!adoptedDrops.has(item.slot.uid)) {
          needsMip = true;
          contention = true;
        }
      }
      continue;
    }
    if (isUnsatisfiable(item, config) || (item.pinned && !flexDur(item))) {
      frozen.push(item);
      continue;
    }
    movable.push(item);
    // An unfilled flexible duration warrants a re-solve, but NOT day mobility —
    // growth is a within-day affair; granting day moves here would explode the
    // model for every fillToMax week. Day mobility (`hot`) is reserved for
    // overlap/padding/sleep participants and dropped optionals. An ADOPTED week
    // inherited already-optimized durations from its template — don't re-derive
    // them for every repeat of the same week.
    if (!adopted && flexDur(item) && p.durationMin < item.intent.duration[1]) {
      needsMip = true;
    }
    if (p.placedDuringSleep && !item.pinned) {
      hot.add(item.slot.uid);
      needsMip = true;
      contention = true;
    }
  }

  // Raw overlap / padding shortfall involving at least one movable participant.
  const movableUids = new Set(movable.map((i) => i.slot.uid));
  const weekPlaced = items
    .map((i) => ({ item: i, p: placedByUid.get(i.slot.uid) }))
    .filter((x): x is { item: Item; p: Placement } => !!x.p);
  if (weekPlaced.length > 0) {
    // Pre-filter the global obstacle set to this week's absolute range (±1 day).
    const bases = weekPlaced.map((x) => absoluteMinutes(c.origin, x.p.date, 0));
    const lo = Math.min(...bases) - 1440;
    const hi = Math.max(...bases) + 2880;
    const nearby: Array<{ startAbs: number; endAbs: number; uid: string | null }> = [];
    for (const q of c.placements) {
      const o = occFor(q, c.origin);
      if (o.endAbs > lo && o.startAbs < hi) nearby.push({ ...o, uid: q.slot.uid });
    }
    for (const f of c.fixedOccupied) {
      if (f.endAbs > lo && f.startAbs < hi) nearby.push({ startAbs: f.startAbs, endAbs: f.endAbs, uid: null });
    }
    for (const { item, p } of weekPlaced) {
      const mine = occFor(p, c.origin);
      const iAmMovable = movableUids.has(item.slot.uid);
      for (const o of nearby) {
        if (o.uid === item.slot.uid) continue;
        if (!iAmMovable && !(o.uid !== null && movableUids.has(o.uid))) continue;
        const overlap = Math.min(mine.endAbs, o.endAbs) - Math.max(mine.startAbs, o.startAbs);
        const gap = -overlap; // free minutes between the intervals when disjoint
        if (overlap > 0 || (padding > 0 && gap < padding)) {
          if (iAmMovable) hot.add(item.slot.uid);
          needsMip = true;
          contention = true;
        }
      }
    }
  }

  return { items, movable, hot, frozen, needsMip, contention };
}

/**
 * Try to adopt the previous week's solved arrangement (the template) as this
 * week's seed. Every item must map to a legal position (windows drift with
 * solar markers — any violation aborts), and the translated week must be no
 * worse than the greedy seed on [overlap, sleep, padding, −placed, −duration].
 * On adoption, placements are updated in place; the returned set holds the
 * uids of optionals the template intentionally leaves unplaced (so they do
 * not re-trigger a solve).
 */
function tryAdoptTemplate(
  items: Item[],
  template: Map<string, { weekday: number; startMin: number; durationMin: number } | null>,
  templateKey: (item: Item, weekday: number) => string,
  placedByUid: Map<string, Placement>,
  c: Construction,
  config: GlobalConfig,
): { adopted: boolean; adoptedDrops: Set<string> } {
  const none = { adopted: false, adoptedDrops: new Set<string>() };
  // Temporary diagnostics (set MILP_DEBUG_ADOPT=1 in node).
  const dbgAdopt = (reason: string, detail = '') => {
    const g = globalThis as { process?: { env?: Record<string, string | undefined> } };
    if (g.process?.env?.MILP_DEBUG_ADOPT) console.error(`adopt-abort: ${reason} ${detail}`);
  };
  if (items.length === 0 || template.size === 0) return none;
  const grid = Math.max(1, config.grid);
  const weekMonday = startOfISOWeek(items[0].slot.date);

  interface Proposal {
    item: Item;
    pos: { date: ISODate; startMin: number; durationMin: number } | null;
  }
  const proposals: Proposal[] = [];
  for (const item of items) {
    // Pinned and unsatisfiable items keep their current state verbatim.
    if (item.pinned || isUnsatisfiable(item, config)) {
      const p = placedByUid.get(item.slot.uid);
      proposals.push({ item, pos: p ? { date: p.date, startMin: p.startMin, durationMin: p.durationMin } : null });
      continue;
    }
    const t = template.get(templateKey(item, isoWeekday(item.slot.date)));
    if (t === undefined) { dbgAdopt('no-template', templateKey(item, isoWeekday(item.slot.date))); return none; }
    if (t === null) {
      if (!item.slot.optional) { dbgAdopt('required-unplaced', item.slot.uid); return none; }
      proposals.push({ item, pos: null });
      continue;
    }
    const date = addDays(weekMonday, t.weekday - 1);
    if (date !== item.slot.date) {
      if (!item.slot.flexibleDay || !(item.slot.bucketDates ?? []).includes(date)) { dbgAdopt('day-move-illegal', item.slot.uid); return none; }
    }
    const rw = resolveWindow(item.intent.window, date, config);
    const [dMin, dMax] = item.intent.duration;
    const dCap = config.fillToMax ? dMax : dMin;
    if (t.durationMin < dMin || t.durationMin > dCap) { dbgAdopt('duration', item.slot.uid); return none; }
    if (t.startMin % grid !== 0) { dbgAdopt('grid', item.slot.uid); return none; }
    if (t.startMin < rw.notBefore || t.startMin + t.durationMin > rw.notAfter) { dbgAdopt('window', `${item.slot.uid} s=${t.startMin} d=${t.durationMin} nb=${rw.notBefore} na=${rw.notAfter}`); return none; }
    proposals.push({ item, pos: { date, startMin: t.startMin, durationMin: t.durationMin } });
  }

  // Day-exclusivity: no two same-intent occurrences on one date unless both native.
  const perIntentDay = new Map<string, number>();
  for (const pr of proposals) {
    if (!pr.pos) continue;
    const k = `${pr.item.slot.intentId}|${pr.pos.date}`;
    const n = (perIntentDay.get(k) ?? 0) + 1;
    perIntentDay.set(k, n);
    if (n > 1 && pr.pos.date !== pr.item.slot.date) { dbgAdopt('day-exclusivity', pr.item.slot.uid); return none; }
  }

  // Compare translated vs current greedy seed: [overlap, sleep, padding,
  // −placedCount, −totalDuration], lexicographic; adopt only when ≤.
  const uidSet = new Set(items.map((i) => i.slot.uid));
  const others: Array<{ startAbs: number; endAbs: number }> = [];
  for (const q of c.placements) if (!uidSet.has(q.slot.uid)) others.push(occFor(q, c.origin));
  for (const f of c.fixedOccupied) others.push(f);
  const score = (arr: Proposal[]): number[] => {
    const mine = arr
      .filter((p) => p.pos)
      .map((p) => ({
        item: p.item,
        startAbs: absoluteMinutes(c.origin, p.pos!.date, p.pos!.startMin),
        endAbs: absoluteMinutes(c.origin, p.pos!.date, p.pos!.startMin + p.pos!.durationMin),
        pos: p.pos!,
      }));
    let ov = 0;
    let ps = 0;
    let sl = 0;
    let dur = 0;
    const padding = config.padding ?? 0;
    for (let i = 0; i < mine.length; i++) {
      const a = mine[i];
      dur += a.pos.durationMin;
      if (!a.item.pinned) {
        const bl = resolveSleepBlackout(a.pos.date, config);
        sl += Math.max(0, bl.wakeStart - a.pos.startMin) + Math.max(0, a.pos.startMin + a.pos.durationMin - bl.sleepStart);
      }
      const consider = (s: number, e: number) => {
        const overlap = Math.min(a.endAbs, e) - Math.max(a.startAbs, s);
        if (overlap > 0) ov += overlap;
        else if (padding > 0 && -overlap < padding) ps += padding + overlap;
      };
      for (let j = i + 1; j < mine.length; j++) consider(mine[j].startAbs, mine[j].endAbs);
      for (const o of others) consider(o.startAbs, o.endAbs);
    }
    return [ov, sl, ps, -mine.length, -dur];
  };

  const current: Proposal[] = items.map((item) => {
    const p = placedByUid.get(item.slot.uid);
    return { item, pos: p ? { date: p.date, startMin: p.startMin, durationMin: p.durationMin } : null };
  });
  const sTranslated = score(proposals);
  const sCurrent = score(current);
  for (let k = 0; k < sTranslated.length; k++) {
    if (sTranslated[k] < sCurrent[k]) break;
    if (sTranslated[k] > sCurrent[k]) { dbgAdopt('score', `tier ${k}: ${sTranslated[k]} > ${sCurrent[k]}`); return none; }
  }

  // Adopt.
  const adoptedDrops = new Set<string>();
  for (const pr of proposals) {
    const uid = pr.item.slot.uid;
    if (!pr.pos) {
      placedByUid.delete(uid);
      if (pr.item.slot.optional) adoptedDrops.add(uid);
      continue;
    }
    const existing = placedByUid.get(uid);
    const placement: Placement = existing ?? {
      slot: pr.item.slot,
      intent: pr.item.intent,
      date: pr.pos.date,
      startMin: pr.pos.startMin,
      durationMin: pr.pos.durationMin,
      placedDuringSleep: false,
      pinned: pr.item.pinned,
      endPinned: pr.item.endPinned,
    };
    placement.date = pr.pos.date;
    placement.startMin = pr.pos.startMin;
    placement.durationMin = pr.pos.durationMin;
    placement.placedDuringSleep = isInSleep(pr.pos.startMin, pr.pos.durationMin, pr.pos.date, config);
    placedByUid.set(uid, placement);
  }
  return { adopted: true, adoptedDrops };
}

/** True when the item's floor fits on none of its candidate days (mirrors bestPlacement's terminal case). */
function isUnsatisfiable(item: Item, config: GlobalConfig): boolean {
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

function buildOccurrences(
  seed: WeekSeed,
  weekKey: string,
  placedByUid: Map<string, Placement>,
  config: GlobalConfig
): WeekOccurrence[] {
  const grid = Math.max(1, config.grid);
  const out: WeekOccurrence[] = [];
  for (const item of seed.movable) {
    const p = placedByUid.get(item.slot.uid);
    const seedPos = p ? { date: p.date, startMin: p.startMin, durationMin: p.durationMin } : null;
    // Non-hot occurrences stay on their CURRENT date (greedy may have spilled
    // them off slot.date); hot ones may roam bucketDates ∩ week.
    const anchor = seedPos?.date ?? item.slot.date;
    let days: ISODate[];
    if (item.pinned || !item.slot.flexibleDay || !seed.hot.has(item.slot.uid)) {
      days = [anchor];
    } else {
      const cand = new Set<ISODate>([item.slot.date, anchor]);
      for (const d of item.slot.bucketDates ?? []) {
        if (isoWeekKey(d) !== weekKey) continue;
        const rw = resolveWindow(item.intent.window, d, config);
        const lo = Math.ceil(rw.notBefore / grid) * grid;
        if (rw.notAfter - item.intent.duration[0] >= lo) cand.add(d);
      }
      days = [...cand].sort();
    }
    out.push({ item, days, seed: seedPos });
  }
  return out;
}

function buildObstacles(
  occ: WeekOccurrence[],
  placedByUid: Map<string, Placement>,
  c: Construction
): DayObstacle[] {
  const modelUids = new Set(occ.map((o) => o.item.slot.uid));
  const dates = new Set<ISODate>();
  for (const o of occ) for (const d of o.days) dates.add(d);
  const sortedDates = [...dates].sort();

  // Absolute intervals of everything NOT in the model: fixed events plus every
  // placement outside the model at its current position (frozen in-week items —
  // pinned fixed-duration, unsatisfiable — are placements too, so they're here).
  const abs: Array<{ startAbs: number; endAbs: number; label: string }> = [];
  for (const f of c.fixedOccupied) abs.push(f);
  for (const p of placedByUid.values()) {
    if (modelUids.has(p.slot.uid)) continue;
    abs.push(occFor(p, c.origin));
  }

  const out: DayObstacle[] = [];
  const seen = new Set<string>();
  for (const date of sortedDates) {
    const base = absoluteMinutes(c.origin, date, 0);
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

function memoKey(model: WeekModel): string {
  return [
    model.constraints.join('\n'),
    model.bounds.join('\n'),
    model.generals.join(' '),
    model.binaries.join(' '),
    model.stages.map((s) => s.name + ':' + [...s.terms.entries()].map(([k, v]) => `${k}=${v}`).join(',')).join(';'),
  ].join('#');
}

function applySolution(
  model: WeekModel,
  occ: WeekOccurrence[],
  values: Map<string, number>,
  placedByUid: Map<string, Placement>,
  config: GlobalConfig
): void {
  for (const dec of model.decode) {
    const o = occ[dec.occIndex];
    const uid = o.item.slot.uid;
    const chosen = dec.aVars.length
      ? dec.aVars.find((a) => (values.get(a.name) ?? 0) > 0.5)
      : dec.fixedDate
        ? { name: '', date: dec.fixedDate }
        : undefined;
    if (!chosen) {
      // Unplaced optional.
      placedByUid.delete(uid);
      continue;
    }
    const startMin = Math.round(values.get(dec.sVar) ?? 0);
    const durationMin = Math.round(values.get(dec.dVar) ?? o.item.intent.duration[0]);
    const existing = placedByUid.get(uid);
    const placement: Placement = existing ?? {
      slot: o.item.slot,
      intent: o.item.intent,
      date: chosen.date,
      startMin,
      durationMin,
      placedDuringSleep: false,
      pinned: o.item.pinned,
      endPinned: o.item.endPinned,
    };
    placement.date = chosen.date;
    placement.startMin = startMin;
    placement.durationMin = durationMin;
    placement.placedDuringSleep = isInSleep(startMin, durationMin, chosen.date, config);
    placedByUid.set(uid, placement);
  }
}
