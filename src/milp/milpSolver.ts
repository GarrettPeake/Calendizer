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
  Occupied,
  greedyPlacements,
  assembleOutput,
  isInSleep,
  occFor,
  repair,
} from '../solver';
import { GlobalConfig, SolveInput, SolveOutput } from '../types';
import { ISODate, isoWeekKey, absoluteMinutes, startOfISOWeek, addDays, weekdayCode } from '../time';
import { resolveWindow, resolveSleepBlackout } from '../markers';
import { buildWeekModel, DayObstacle, WeekOccurrence, WeekModel } from './lp';
import { HighsInstance, runStages, StageTrace } from './stages';

/** Optional hooks: per-week traces for tooling, and start/per-week ticks that
 *  double as a REAL progress signal (weeks done / total) for UIs. */
export interface MilpDebugSink {
  onStart?(totalWeeks: number): void;
  onWeek?(weekKey: string, info: { skipped: boolean; fallback?: boolean; memo?: boolean; trace?: StageTrace[] }): void;
}

/** The solver's model-solution memo: full model text → solved var values. */
export type MilpMemo = Map<string, Map<string, number> | null>;

export function createMilpSolver(highs: HighsInstance, debug?: MilpDebugSink, memo?: MilpMemo): Solver {
  // Model-content-addressed memo, persistent ACROSS solves on this instance
  // (and, when the caller supplies and persists the Map — e.g. the web worker
  // via IndexedDB — across page loads): an edit or reload re-solves only the
  // weeks whose models actually changed. Safe because the key is the FULL
  // model text: identical key ⇒ identical model ⇒ identical solution.
  const memoMap: MilpMemo = memo ?? new Map();
  return {
    solve(input: SolveInput): SolveOutput {
      const c = greedyPlacements(input);
      solveWeeks(highs, c, input, memoMap, debug);
      return assembleOutput(c, input);
    },
  };
}

/** Model-size safety valve: beyond this many rows, keep the greedy week. */
const MAX_ROWS = 30000;

function solveWeeks(
  highs: HighsInstance,
  c: Construction,
  input: SolveInput,
  memo: Map<string, Map<string, number> | null>,
  debug?: MilpDebugSink
): void {
  const config = input.config;
  const today = input.today ?? '0000-00-00'; // no `today` ⇒ every day is visible
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
  debug?.onStart?.(weekKeys.length);

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


  // Week-to-week solution translation: the previous week's solved arrangement,
  // keyed by (intentId, perDayIndex, weekday), proposed as this week's seed.
  // When the proposal is still legal (windows drift with solar markers) and no
  // worse than the greedy seed, the week inherits it — a periodic year then
  // costs one hard solve plus cheap verifications, and habits stay put.
  const template = new Map<string, { weekday: number; startMin: number; durationMin: number } | null>();
  const templateKey = (item: Item, weekday: number) => `${item.slot.intentId}|${item.slot.perDayIndex}|${weekday}`;
  // The quality the template week actually achieved — a translation must match
  // it (not merely beat the greedy seed, whose doubled days lose at tier 0 to
  // almost anything) or the week solves fresh.
  let templateScore: number[] | null = null;

  for (const wk of weekKeys) {
    const items = weeks.get(wk)!;
    const adoption = tryAdoptTemplate(items, template, templateKey, templateScore, placedByUid, c, config);
    const recordTemplate = () => {
      for (const item of items) {
        const p = placedByUid.get(item.slot.uid);
        const wd = isoWeekday(item.slot.date);
        template.set(templateKey(item, wd), p ? { weekday: isoWeekday(p.date), startMin: p.startMin, durationMin: p.durationMin } : null);
      }
      templateScore = scoreWeekArrangement(items, placedByUid, c, config);
    };
    // An adopted week inherited a fully-solved arrangement (validated legal
    // and lexicographically no worse than the greedy seed, doubling first) —
    // nothing left to solve, even when it carries a structurally-forced
    // overlap that would otherwise re-trigger a solve every single week.
    if (adoption.adopted) {
      debug?.onWeek?.(wk, { skipped: true });
      recordTemplate();
      accumulateHabit(items);
      continue;
    }
    const seed = analyzeWeek(items, placedByUid, droppedUids, c, config, adoption, today);
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
      const occA = buildOccurrences(seed, wk, placedByUid, config, today);
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
  adoption: { adopted: boolean; adoptedDrops: Set<string> },
  today: string
): WeekSeed {
  const { adopted, adoptedDrops } = adoption;
  // Placements the temporal overlay will DROP (past days) are invisible to the
  // user — they neither trigger a solve nor count as contention.
  const visible = (p: Placement) => p.date >= today;
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
    if (!adopted && flexDur(item) && p.durationMin < item.intent.duration[1] && visible(p)) {
      needsMip = true;
    }
    if (p.placedDuringSleep && !item.pinned && visible(p)) {
      hot.add(item.slot.uid);
      needsMip = true;
      contention = true;
    }
  }

  // Same-intent DAY DOUBLING: greedy's expansion picks extra days before the
  // solve, so a spilled floor can end up sharing a day with an extra (the
  // "two Park times on Saturday" bug). Per_day stacks (same slot.date) share
  // their day by design; anything else on one date is contention — mark all
  // participants hot so phase A can pull them apart.
  {
    const byIntentDay = new Map<string, Item[]>();
    for (const item of movable) {
      const p = placedByUid.get(item.slot.uid);
      if (!p || !visible(p)) continue;
      const k = `${item.slot.intentId}|${p.date}`;
      const arr = byIntentDay.get(k) ?? [];
      arr.push(item);
      byIntentDay.set(k, arr);
    }
    const doubledIntents = new Set<string>();
    for (const group of byIntentDay.values()) {
      if (group.length < 2) continue;
      const stackDate = group[0].slot.date;
      if (group.every((i) => i.slot.date === stackDate)) continue; // per_day stack
      doubledIntents.add(group[0].slot.intentId);
      needsMip = true;
      contention = true;
    }
    // The whole intent is one coupled system: every one of its occurrences
    // (not just the doubled pair) needs day mobility, or a cold sibling can
    // block the only clean rearrangement.
    for (const item of movable) {
      if (doubledIntents.has(item.slot.intentId)) hot.add(item.slot.uid);
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
      if (!visible(p)) continue; // invisible placements aren't contention
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

interface ArrangementEntry {
  item: Item;
  pos: { date: ISODate; startMin: number; durationMin: number } | null;
}

/**
 * Score a week arrangement on [doubling, overlap, sleep, padding,
 * −placedCount, −totalDuration] against the rest of the calendar — the same
 * lexicographic order as the solver's stages, so adoption decisions and solved
 * results are directly comparable.
 */
function scoreProposals(arr: ArrangementEntry[], items: Item[], c: Construction, config: GlobalConfig): number[] {
  const uidSet = new Set(items.map((i) => i.slot.uid));
  const others: Array<{ startAbs: number; endAbs: number }> = [];
  for (const q of c.placements) if (!uidSet.has(q.slot.uid)) others.push(occFor(q, c.origin));
  for (const f of c.fixedOccupied) others.push(f);
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
  let dbl = 0;
  const padding = config.padding ?? 0;
  // Same-intent day doubling (per_day stacks exempt).
  const perDay = new Map<string, number>();
  for (const p of mine) {
    if (p.item.slot.date === p.pos.date) continue; // native/stack residency
    const k = `${p.item.slot.intentId}|${p.pos.date}`;
    perDay.set(k, (perDay.get(k) ?? 0) + 1);
  }
  for (const [k, movers] of perDay) {
    const hasNative = mine.some((p) => `${p.item.slot.intentId}|${p.pos.date}` === k && p.item.slot.date === p.pos.date);
    dbl += Math.max(0, movers - (hasNative ? 0 : 1));
  }
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
  return [dbl, ov, sl, ps, -mine.length, -dur];
}

/** Score a week's CURRENT placements (used to stamp the template's quality). */
function scoreWeekArrangement(
  items: Item[],
  placedByUid: Map<string, Placement>,
  c: Construction,
  config: GlobalConfig
): number[] {
  const arr: ArrangementEntry[] = items.map((item) => {
    const p = placedByUid.get(item.slot.uid);
    return { item, pos: p ? { date: p.date, startMin: p.startMin, durationMin: p.durationMin } : null };
  });
  return scoreProposals(arr, items, c, config);
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
  templateScore: number[] | null,
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
    if (t.startMin % grid !== 0) { dbgAdopt('grid', item.slot.uid); return none; }
    // Windows drift week to week (solar markers): CLAMP the proposal into the
    // new window rather than aborting — the H comparison below still gates
    // adoption, so a clamp that lands on a neighbour loses fairly.
    let dur = Math.max(dMin, Math.min(t.durationMin, dCap, rw.notAfter - rw.notBefore));
    if (dur < dMin) { dbgAdopt('duration', item.slot.uid); return none; }
    let s = Math.min(t.startMin, Math.floor((rw.notAfter - dur) / grid) * grid);
    s = Math.max(s, Math.ceil(rw.notBefore / grid) * grid);
    if (s < rw.notBefore || s + dur > rw.notAfter) { dbgAdopt('window', `${item.slot.uid} s=${s} d=${dur} nb=${rw.notBefore} na=${rw.notAfter}`); return none; }
    proposals.push({ item, pos: { date, startMin: s, durationMin: dur } });
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

  // POLISH: solar-pinned events (e.g. "watch sunset") drift a little every
  // day, so a literal translation leaves small overlaps against them. Greedy's
  // repair pass (single-move, milliseconds) absorbs that drift before the
  // quality gate — most weeks then reproduce the template score EXACTLY.
  {
    const uidSet = new Set(items.map((i) => i.slot.uid));
    // Obstacles limited to the week's absolute neighborhood (±1 day) — repair
    // scans its obstacle list per candidate slot, so handing it the whole
    // calendar (~thousands) would cost more than the solve it avoids.
    const bases = proposals.filter((pr) => pr.pos).map((pr) => absoluteMinutes(c.origin, pr.pos!.date, 0));
    const lo = (bases.length ? Math.min(...bases) : 0) - 1440;
    const hi = (bases.length ? Math.max(...bases) : 0) + 2880;
    const fixed: Occupied[] = [];
    for (const q of c.placements) {
      if (uidSet.has(q.slot.uid)) continue;
      const o = occFor(q, c.origin);
      if (o.endAbs > lo && o.startAbs < hi) fixed.push(o);
    }
    for (const f of c.fixedOccupied) if (f.endAbs > lo && f.startAbs < hi) fixed.push(f);
    const temp: Placement[] = [];
    const byProposal = new Map<ArrangementEntry, Placement>();
    for (const pr of proposals) {
      if (!pr.pos) continue;
      const pl: Placement = {
        slot: pr.item.slot,
        intent: pr.item.intent,
        date: pr.pos.date,
        startMin: pr.pos.startMin,
        durationMin: pr.pos.durationMin,
        placedDuringSleep: false,
        pinned: pr.item.pinned,
        endPinned: pr.item.endPinned,
      };
      temp.push(pl);
      byProposal.set(pr, pl);
    }
    const before = new Map(temp.map((pl) => [pl, { date: pl.date, startMin: pl.startMin }]));
    repair(temp, fixed, config, c.origin);
    // repair()'s move search doesn't know about day-exclusivity — it will
    // happily "fix" a structurally-forced overlap (park vs work) by moving the
    // occurrence onto a same-intent day. Revert any move that created a
    // doubling; drift fixes (time shifts on the same day) survive.
    const residents = new Map<string, Placement[]>();
    for (const pl of temp) {
      const k = `${pl.slot.intentId}|${pl.date}`;
      const arr = residents.get(k) ?? [];
      arr.push(pl);
      residents.set(k, arr);
    }
    for (const group of residents.values()) {
      if (group.length < 2) continue;
      const stackDate = group[0].slot.date;
      if (group.every((g) => g.slot.date === stackDate)) continue; // per_day stack
      for (const pl of group) {
        const b = before.get(pl)!;
        if (b.date !== pl.date) {
          pl.date = b.date;
          pl.startMin = b.startMin;
        }
      }
    }
    for (const [pr, pl] of byProposal) {
      pr.pos = { date: pl.date, startMin: pl.startMin, durationMin: pl.durationMin };
    }
  }

  // Compare translated vs BOTH baselines, lexicographic on
  // [doubling, overlap, sleep, padding, −placedCount, −totalDuration]:
  //  - the current greedy seed (adoption must never make the week worse), and
  //  - the TEMPLATE week's achieved score (a translation must reproduce the
  //    solved quality; beating a doubled greedy seed alone is a low bar, and
  //    accepting degraded translations compounds week over week).
  const current: Proposal[] = items.map((item) => {
    const p = placedByUid.get(item.slot.uid);
    return { item, pos: p ? { date: p.date, startMin: p.startMin, durationMin: p.durationMin } : null };
  });
  const sTranslated = scoreProposals(proposals, items, c, config);
  const sCurrent = scoreProposals(current, items, c, config);
  for (let k = 0; k < sTranslated.length; k++) {
    if (sTranslated[k] < sCurrent[k]) break;
    if (sTranslated[k] > sCurrent[k]) { dbgAdopt('score', `tier ${k}: ${sTranslated[k]} > ${sCurrent[k]}`); return none; }
  }
  if (templateScore) {
    // Post-polish tolerance: repair absorbs most solar drift; what's left is
    // minutes-scale wobble (a sunset event a few minutes shorter, a 5-minute
    // residual overlap) that isn't worth a multi-second re-solve. Bounded
    // relative to the TEMPLATE (updated only on real solves) → no compounding.
    // Doubling and the placed count stay exact.
    const tol = [0, 0, 0, 10, 0, 45];
    for (let k = 0; k < sTranslated.length; k++) {
      if (sTranslated[k] < templateScore[k]) break;
      if (sTranslated[k] > templateScore[k] + tol[k]) {
        dbgAdopt('template-degraded', `tier ${k}: ${sTranslated[k]} > ${templateScore[k]} + ${tol[k]}`);
        return none;
      }
    }
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
  config: GlobalConfig,
  today: string
): WeekOccurrence[] {
  const grid = Math.max(1, config.grid);
  const out: WeekOccurrence[] = [];
  for (const item of seed.movable) {
    const p = placedByUid.get(item.slot.uid);
    const seedPos = p ? { date: p.date, startMin: p.startMin, durationMin: p.durationMin } : null;
    // Non-hot occurrences stay on their CURRENT date (greedy may have spilled
    // them off slot.date); hot ones may roam bucketDates ∩ week — but never
    // into the past: a placement the overlay drops looks in-model-clean while
    // silently deleting a required occurrence from the visible calendar.
    const anchor = seedPos?.date ?? item.slot.date;
    let days: ISODate[];
    if (item.pinned || !item.slot.flexibleDay || !seed.hot.has(item.slot.uid)) {
      days = [anchor];
    } else {
      const cand = new Set<ISODate>();
      if (item.slot.date >= today) cand.add(item.slot.date);
      if (anchor >= today) cand.add(anchor);
      for (const d of item.slot.bucketDates ?? []) {
        if (isoWeekKey(d) !== weekKey || d < today) continue;
        const rw = resolveWindow(item.intent.window, d, config);
        const lo = Math.ceil(rw.notBefore / grid) * grid;
        if (rw.notAfter - item.intent.duration[0] >= lo) cand.add(d);
      }
      if (cand.size === 0) cand.add(anchor); // everything is past — leave it be
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
