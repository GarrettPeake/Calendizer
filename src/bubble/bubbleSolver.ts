/**
 * The bubble solver: event-first placement with fresh-reflow evaluation of
 * every candidate (day, ordinal), then budgeted optimization cycles.
 *
 * Per ISO week, chronologically:
 *   P0  statics: pinned fixed-duration, unsatisfiable, invisible (past) and
 *       no-legal-day items keep their greedy placements verbatim — terrain.
 *   P1  required floors, most-constrained-first: try EVERY (valid day ×
 *       insertion ordinal), fresh reflow each, best heuristic wins; no valid
 *       placement → pool.
 *   P2  pool rescue: pop a placed victim, place both; keep only on strict
 *       lexicographic improvement of the shared H vector.
 *   P3  leftovers hard-place at min-overlap (bestPlacement) and LOCK —
 *       ignored by later phases (user spec); conflicts derive post-hoc.
 *   P4  optionals, priority-weight-sampled without replacement, CLEAN
 *       insertions only ("extras are never forced" by construction), then
 *       rescue cycles among optionals.
 *   P5  optimization sweeps to quiescence under a step budget: regret-ordered
 *       re-placement, accepted on strict improvement of [H, habit, earliness];
 *       final revive pass for dropped optionals.
 *
 * Week-to-week: a day-relative template (assigned weekday + ordinal — NO
 * times; reflow re-derives them, absorbing solar drift by construction) pours
 * the next week; individual floor-failures pop and re-place; an element-wise
 * per-tier gate versus the template week's score falls back to a fresh solve.
 * Week 1 warm-starts from `input.templateHint` (the previously published
 * calendar) so an unchanged intent set reproduces itself instead of churning.
 *
 * A per-week never-worse-than-greedy guard restores the greedy arrangement
 * whenever bubble's final score is lexicographically worse. Determinism:
 * fixed-seed PRNG, stable iteration orders, integer arithmetic.
 */
import {
  Solver,
  Construction,
  Item,
  Placement,
  Occupied,
  greedyPlacements,
  assembleOutput,
  bestPlacement,
  isInSleep,
  occFor,
} from '../solver';
import { GlobalConfig, SolveInput, SolveOutput } from '../types';
import { ISODate, isoWeekKey, startOfISOWeek, addDays } from '../time';
import { scoreWeekArrangement } from '../scoring';
import { isoWeekday, isUnsatisfiable, createHabitTracker, templateKeyOf, habitKeyOf } from '../weekShared';
import { WeekState, TrialResult, CandidateScore, betterCandidate } from './insert';
import { mulberry32, FIXED_SEED, weightedOrder, Rng } from './rng';

export interface BubbleOptions {
  /** Pool-rescue / optional-cycle attempt budget per week. */
  M?: number;
  /** Optimization-step budget per freshly solved week. */
  J?: number;
  /** Optimization-step budget per template-poured week. */
  JPolish?: number;
}

export interface BubbleDebugSink {
  onStart?(totalWeeks: number): void;
  onWeek?(weekKey: string, info: { poured: boolean; pops: number; pooled: number; guarded: boolean }): void;
}

export function createBubbleSolver(opts: BubbleOptions = {}, debug?: BubbleDebugSink): Solver {
  const budget = { M: opts.M ?? 200, J: opts.J ?? 500, JPolish: opts.JPolish ?? 50 };
  return {
    solve(input: SolveInput): SolveOutput {
      const c = greedyPlacements(input);
      solveBubble(c, input, budget, debug);
      return assembleOutput(c, input);
    },
  };
}

interface PosSnapshot {
  item: Item;
  pos: { date: ISODate; startMin: number; durationMin: number } | null;
}

/** Element-wise template-gate tolerances (same as MIP adoption). */
const GATE_TOL = [0, 0, 0, 10, 0, 45];

function lexLess(a: number[], b: number[]): boolean {
  for (let k = 0; k < Math.max(a.length, b.length); k++) {
    const av = a[k] ?? 0;
    const bv = b[k] ?? 0;
    if (av !== bv) return av < bv;
  }
  return false;
}

function solveBubble(
  c: Construction,
  input: SolveInput,
  budget: { M: number; J: number; JPolish: number },
  debug?: BubbleDebugSink
): void {
  const config = input.config;
  const today = input.today ?? '0000-00-00';
  const placedByUid = new Map<string, Placement>(c.placements.map((p) => [p.slot.uid, p]));
  const habit = createHabitTracker(placedByUid);
  const rng = mulberry32(FIXED_SEED);
  const flexDur = (i: Item) => !!config.fillToMax && i.intent.duration[1] > i.intent.duration[0];

  const weeks = new Map<string, Item[]>();
  for (const item of c.items) {
    const wk = isoWeekKey(item.slot.date);
    const arr = weeks.get(wk) ?? [];
    arr.push(item);
    weeks.set(wk, arr);
  }
  const weekKeys = [...weeks.keys()].sort();
  debug?.onStart?.(weekKeys.length);

  // Week-to-week template: (intentId|perDayIndex|weekday) → assigned weekday +
  // ordinal-in-day, or null (intentionally dropped optional).
  let template: Map<string, { weekday: number; ordinal: number } | null> | null = null;
  let templateScore: number[] | null = null;

  // Week-1 warm start from the previously published calendar (uid → position).
  const hint = new Map<string, { date: ISODate; clockMin: number }>();
  for (const inst of input.templateHint ?? []) {
    const hh = Number(inst.start.slice(11, 13));
    const mm = Number(inst.start.slice(14, 16));
    hint.set(inst.uid, { date: inst.date, clockMin: hh * 60 + mm });
  }

  for (const wk of weekKeys) {
    const items = weeks.get(wk)!;
    const monday = startOfISOWeek(items[0].slot.date);
    const dates: ISODate[] = Array.from({ length: 7 }, (_, i) => addDays(monday, i));

    // ---- P0: classify. Everything not movable keeps its greedy placement. --
    const movable: Item[] = [];
    const candDays = new Map<string, ISODate[]>();
    for (const item of items) {
      const p = placedByUid.get(item.slot.uid);
      if (isUnsatisfiable(item, config)) continue; // greedy clamp carries the conflict
      if (item.pinned && !flexDur(item)) continue; // frozen at its pin
      if (p && p.date < today) continue; // invisible past placement — verbatim
      const base =
        !item.pinned && item.slot.flexibleDay && item.slot.bucketDates?.length ? item.slot.bucketDates : [item.slot.date];
      const days = [...new Set(base)].filter((d) => isoWeekKey(d) === wk && d >= today);
      if (days.length === 0) continue; // nothing legal this week — keep greedy
      movable.push(item);
      candDays.set(item.slot.uid, days);
    }
    const movableUids = new Set(movable.map((i) => i.slot.uid));
    const itemByUid = new Map(items.map((i) => [i.slot.uid, i]));

    // Never-worse-than-greedy guard: snapshot before bubble touches the week.
    const greedySnapshot: PosSnapshot[] = items.map((item) => {
      const p = placedByUid.get(item.slot.uid);
      return { item, pos: p ? { date: p.date, startMin: p.startMin, durationMin: p.durationMin } : null };
    });
    const greedyScore = scoreWeekArrangement(items, placedByUid, c, config);

    // Bubble constructs the week fresh: movable placements clear.
    for (const uid of movableUids) placedByUid.delete(uid);

    const state = new WeekState(dates, itemByUid, movableUids, placedByUid, c, config);
    const habitTargets = habit.targets();

    const ctx: WeekCtx = {
      state,
      movable,
      movableUids,
      candDays,
      itemByUid,
      placedByUid,
      items,
      c,
      config,
      habitTargets,
      rng,
      monday,
    };

    // ---- Pour (template or week-1 hint) or fresh solve. -------------------
    let poured = false;
    let pops = 0;
    let pooled = 0;
    const fresh = () => {
      const result = solveFresh(ctx, budget);
      pops = result.pops;
      pooled = result.pooled;
    };
    if (template && templateScore) {
      const allMovable = [...movableUids]; // hardPlace shrinks the live set
      const r = pourTemplate(ctx, template, budget);
      pops = r.pops;
      pooled = r.pooled;
      const gated = scoreWeekArrangement(items, placedByUid, c, config);
      let ok = true;
      for (let k = 0; k < gated.length; k++) {
        if (gated[k] > templateScore[k] + (GATE_TOL[k] ?? 0)) {
          ok = false;
          break;
        }
      }
      if (ok) {
        poured = true;
      } else {
        // Element-wise gate failed — reset the week (locks included) and
        // solve fresh.
        for (const uid of allMovable) {
          state.remove(uid);
          placedByUid.delete(uid);
          movableUids.add(uid);
        }
        state.invalidateObstacles();
        fresh();
      }
    } else if (hint.size > 0 && [...movableUids].some((uid) => hint.has(uid))) {
      pourHint(ctx, hint, budget);
      poured = true; // warm start, no gate — the greedy guard below still applies
    } else {
      fresh();
    }

    // ---- Guard: never worse than the greedy seed. -------------------------
    const bubbleScore = scoreWeekArrangement(items, placedByUid, c, config);
    let guarded = false;
    if (lexLess(greedyScore, bubbleScore)) {
      restore(greedySnapshot, placedByUid, config);
      guarded = true;
    }

    // ---- Record template + habit from the FINAL arrangement. --------------
    template = recordTemplate(items, movable, placedByUid);
    templateScore = scoreWeekArrangement(items, placedByUid, c, config);
    habit.accumulate(items);
    debug?.onWeek?.(wk, { poured, pops, pooled, guarded });
  }

  // Rebuild placements in canonical item order from the final arrangement.
  c.placements = c.items
    .map((i) => placedByUid.get(i.slot.uid))
    .filter((p): p is Placement => !!p);
}

interface WeekCtx {
  state: WeekState;
  movable: Item[];
  movableUids: Set<string>;
  candDays: Map<string, ISODate[]>;
  itemByUid: Map<string, Item>;
  placedByUid: Map<string, Placement>;
  items: Item[];
  c: Construction;
  config: GlobalConfig;
  habitTargets: Map<string, number>;
  rng: Rng;
  monday: ISODate;
}

/** Same-intent day-exclusivity, keyed by residency: a candidate day is
 *  blocked when ANY other occurrence of the intent already sits there —
 *  unless both are natives of that day (a true per_day stack). */
function dayBlocked(ctx: WeekCtx, item: Item, date: ISODate): boolean {
  for (const p of ctx.placedByUid.values()) {
    if (p.slot.uid === item.slot.uid || p.slot.intentId !== item.slot.intentId) continue;
    if (p.date !== date) continue;
    if (p.slot.date === date && item.slot.date === date) continue; // per_day stack
    return true;
  }
  return false;
}

/** Try `item` on every valid day at every ordinal; commit the best candidate.
 *  Returns true when placed. */
function placeBest(ctx: WeekCtx, item: Item): boolean {
  const uid = item.slot.uid;
  const days = ctx.candDays.get(uid) ?? [];
  let best: { trial: TrialResult; score: CandidateScore } | null = null;
  for (let di = 0; di < days.length; di++) {
    const date = days[di];
    if (dayBlocked(ctx, item, date)) continue;
    const before = ctx.state.weightedOf(date);
    const trial = ctx.state.tryInsert(uid, date);
    if (!trial) continue;
    const bub = ctx.state.bubbleOn(uid, date)!;
    const start = trial.starts[trial.ordinal];
    const target = ctx.habitTargets.get(habitKeyOf(item));
    const score: CandidateScore = {
      deltaWeighted: trial.weightedDuration - before,
      nativeDay: date === item.slot.date ? 0 : 1,
      load: ctx.state.loadOf(date),
      habitDist: target === undefined ? 0 : Math.abs(start - target),
      earliness: start - bub.notBefore,
      dayIndex: di,
      ordinal: trial.ordinal,
    };
    if (!best || betterCandidate(score, best.score)) best = { trial, score };
  }
  if (!best) return false;
  ctx.state.commitInsert(uid, best.trial);
  return true;
}

/** Week score through the one shared H function. */
function weekScore(ctx: WeekCtx): number[] {
  return scoreWeekArrangement(ctx.items, ctx.placedByUid, ctx.c, ctx.config);
}

/** H extended with [habit distance, weighted earliness] so P5 nudges count. */
function weekScoreExt(ctx: WeekCtx): number[] {
  const base = weekScore(ctx);
  let habitDist = 0;
  let earliness = 0;
  for (const item of ctx.movable) {
    const p = ctx.placedByUid.get(item.slot.uid);
    if (!p || !ctx.movableUids.has(item.slot.uid)) continue; // locked items are constants
    const target = ctx.habitTargets.get(habitKeyOf(item));
    if (target !== undefined) habitDist += Math.abs(p.startMin - target);
    const bub = ctx.state.bubbleOn(item.slot.uid, p.date);
    if (bub) earliness += bub.weight * Math.max(0, p.startMin - bub.notBefore);
  }
  return [...base, habitDist, earliness];
}

interface WeekSnapshot {
  positions: Map<string, { date: ISODate; startMin: number; durationMin: number } | null>;
  seq: Map<ISODate, string[]>;
}

function takeSnapshot(ctx: WeekCtx): WeekSnapshot {
  const positions = new Map<string, { date: ISODate; startMin: number; durationMin: number } | null>();
  for (const uid of ctx.movableUids) {
    const p = ctx.placedByUid.get(uid);
    positions.set(uid, p ? { date: p.date, startMin: p.startMin, durationMin: p.durationMin } : null);
  }
  return { positions, seq: ctx.state.snapshotSeq() };
}

function restoreSnapshot(ctx: WeekCtx, snap: WeekSnapshot): void {
  ctx.state.restoreSeq(snap.seq);
  for (const [uid, pos] of snap.positions) {
    if (!pos) {
      ctx.placedByUid.delete(uid);
      continue;
    }
    const item = ctx.itemByUid.get(uid)!;
    const existing = ctx.placedByUid.get(uid);
    const placement: Placement = existing ?? {
      slot: item.slot,
      intent: item.intent,
      date: pos.date,
      startMin: pos.startMin,
      durationMin: pos.durationMin,
      placedDuringSleep: false,
      pinned: item.pinned,
      endPinned: item.endPinned,
    };
    placement.date = pos.date;
    placement.startMin = pos.startMin;
    placement.durationMin = pos.durationMin;
    placement.placedDuringSleep = isInSleep(pos.startMin, pos.durationMin, pos.date, ctx.config);
    ctx.placedByUid.set(uid, placement);
  }
}

/** Restore the pre-bubble greedy arrangement (the never-worse guard). */
function restore(snapshot: PosSnapshot[], placedByUid: Map<string, Placement>, config: GlobalConfig): void {
  for (const { item, pos } of snapshot) {
    const uid = item.slot.uid;
    if (!pos) {
      placedByUid.delete(uid);
      continue;
    }
    const existing = placedByUid.get(uid);
    const placement: Placement = existing ?? {
      slot: item.slot,
      intent: item.intent,
      date: pos.date,
      startMin: pos.startMin,
      durationMin: pos.durationMin,
      placedDuringSleep: false,
      pinned: item.pinned,
      endPinned: item.endPinned,
    };
    placement.date = pos.date;
    placement.startMin = pos.startMin;
    placement.durationMin = pos.durationMin;
    placement.placedDuringSleep = isInSleep(pos.startMin, pos.durationMin, pos.date, config);
    placedByUid.set(uid, placement);
  }
}

/** P2/P4 rescue cycles: place a pooled event by popping one victim, keeping
 *  the change only on strict lexicographic H improvement. Deterministic
 *  exhaustive enumeration under the attempt budget. */
function rescue(ctx: WeekCtx, pool: Item[], victimOk: (v: Item) => boolean, maxAttempts: number): Item[] {
  let attempts = 0;
  const remaining: Item[] = [];
  for (const pe of pool) {
    let placedIt = false;
    outer: for (const date of ctx.candDays.get(pe.slot.uid) ?? []) {
      for (const victimUid of [...ctx.state.sequenceOf(date)]) {
        if (attempts >= maxAttempts) break outer;
        const victim = ctx.itemByUid.get(victimUid)!;
        if (!victimOk(victim)) continue;
        attempts++;
        const snap = takeSnapshot(ctx);
        const before = weekScore(ctx);
        ctx.state.remove(victimUid);
        if (!placeBest(ctx, pe) || !placeBest(ctx, victim)) {
          restoreSnapshot(ctx, snap);
          continue;
        }
        const after = weekScore(ctx);
        if (lexLess(after, before)) {
          placedIt = true;
          break outer;
        }
        restoreSnapshot(ctx, snap);
      }
    }
    if (!placedIt) remaining.push(pe);
  }
  return remaining;
}

/** P5: regret-ordered re-placement sweeps to quiescence + optional revive. */
function optimize(ctx: WeekCtx, steps: number): void {
  let left = steps;
  let improved = true;
  while (improved && left > 0) {
    improved = false;
    // Regret: unfilled weighted duration + habit distance. Recomputed per sweep.
    const order = ctx.movable
      .filter((i) => ctx.placedByUid.has(i.slot.uid) && ctx.movableUids.has(i.slot.uid))
      .map((item) => {
        const p = ctx.placedByUid.get(item.slot.uid)!;
        const bub = ctx.state.bubbleOn(item.slot.uid, p.date);
        const target = ctx.habitTargets.get(habitKeyOf(item));
        const regret =
          (bub ? bub.weight * Math.max(0, bub.max - p.durationMin) : 0) +
          (target === undefined ? 0 : Math.abs(p.startMin - target));
        return { item, regret };
      })
      .sort((a, b) => b.regret - a.regret || (a.item.slot.uid < b.item.slot.uid ? -1 : 1));
    for (const { item } of order) {
      if (left-- <= 0) return;
      const snap = takeSnapshot(ctx);
      const before = weekScoreExt(ctx);
      ctx.state.remove(item.slot.uid);
      if (!placeBest(ctx, item)) {
        restoreSnapshot(ctx, snap);
        continue;
      }
      const after = weekScoreExt(ctx);
      if (lexLess(after, before)) improved = true;
      else restoreSnapshot(ctx, snap);
    }
    // Revive: moves may have opened room for dropped optionals.
    for (const item of ctx.movable) {
      if (!item.slot.optional || ctx.placedByUid.has(item.slot.uid)) continue;
      if (placeBest(ctx, item)) improved = true;
    }
  }
}

/** P3: hard-place at minimum overlap (greedy's bestPlacement), then lock.
 *  Overlap with a BLOCKER is preferred over overlap with a real event: the
 *  blocker absorbs it as a `blockedBy` label (winter's in-work-hours sunset
 *  lives inside Work like lunch does) while a real overlap is a visible
 *  conflict — so first seek a slot that is clean among non-blockers. */
function hardPlace(ctx: WeekCtx, item: Item): void {
  const uid = item.slot.uid;
  const days = ctx.candDays.get(uid) ?? [];
  const occupied: Occupied[] = [...ctx.c.fixedOccupied];
  const nonBlocker: Occupied[] = [...ctx.c.fixedOccupied];
  for (const p of ctx.placedByUid.values()) {
    if (p.slot.uid === uid) continue;
    const occ = occFor(p, ctx.c.origin);
    occupied.push(occ);
    if (!p.intent.blocker) nonBlocker.push(occ);
  }
  const slot = {
    ...item.slot,
    date: days.includes(item.slot.date) ? item.slot.date : days[0] ?? item.slot.date,
    bucketDates: days.length > 0 ? days : undefined,
  };
  const soft = bestPlacement(slot, item.intent, ctx.config, nonBlocker, ctx.c.origin);
  const r = soft.overlapMin === 0 ? soft : bestPlacement(slot, item.intent, ctx.config, occupied, ctx.c.origin);
  const placement: Placement = {
    slot: item.slot,
    intent: item.intent,
    date: r.date,
    startMin: r.startMin,
    durationMin: item.intent.duration[0],
    placedDuringSleep: r.placedDuringSleep,
    pinned: item.pinned,
    endPinned: item.endPinned,
  };
  ctx.placedByUid.set(uid, placement);
  // Locked: later phases never re-place it, and it becomes TERRAIN. Movable
  // events it landed on re-layout around it (a winter sunset wedged at the
  // end of Work pushes Pottery later, exactly as the exact solver did);
  // whatever cannot re-place cascades into its own hard placement, and only
  // overlap against genuinely immovable terrain survives as a conflict.
  ctx.movableUids.delete(uid);
  ctx.state.invalidateObstacles();
  for (const poppedUid of ctx.state.reflowAll()) {
    const popped = ctx.itemByUid.get(poppedUid)!;
    if (!placeBest(ctx, popped) && !popped.slot.optional) hardPlace(ctx, popped);
  }
}

/** The fresh path: P1 → P2 → P3 → P4 → P5. */
function solveFresh(ctx: WeekCtx, budget: { M: number; J: number; JPolish: number }): { pops: number; pooled: number } {
  // P1: required floors, most-constrained-first.
  const required = ctx.movable.filter((i) => !i.slot.optional);
  const constrainedness = (i: Item) => {
    const days = ctx.candDays.get(i.slot.uid) ?? [];
    let slack = Infinity;
    for (const d of days) {
      const b = ctx.state.bubbleOn(i.slot.uid, d);
      if (b) slack = Math.min(slack, b.notAfter - b.notBefore - b.floor);
    }
    return { days: days.length, slack };
  };
  const ranked = required
    .map((item) => ({ item, k: constrainedness(item) }))
    .sort(
      (a, b) =>
        a.k.days - b.k.days ||
        a.k.slack - b.k.slack ||
        (b.item.intent.priority ?? 0) - (a.item.intent.priority ?? 0) ||
        (a.item.slot.uid < b.item.slot.uid ? -1 : 1)
    );
  let pool: Item[] = [];
  for (const { item } of ranked) {
    if (!placeBest(ctx, item)) pool.push(item);
  }

  // P2: pool rescue against any placed victim.
  if (pool.length > 0) pool = rescue(ctx, pool, () => true, budget.M);

  // P3: hard-place what remains; locked and ignored thereafter.
  const pooled = pool.length;
  for (const item of pool) hardPlace(ctx, item);

  // P4: optionals, weight-sampled without replacement; then optional-only cycles.
  const optionals = ctx.movable.filter((i) => i.slot.optional);
  const order = weightedOrder(ctx.rng, optionals.map((i) => (i.intent.priority ?? 0) + 1));
  let optPool: Item[] = [];
  for (const k of order) {
    if (!placeBest(ctx, optionals[k])) optPool.push(optionals[k]);
  }
  if (optPool.length > 0) rescue(ctx, optPool, (v) => !!v.slot.optional, budget.M);

  // P5: optimization sweeps.
  optimize(ctx, budget.J);
  return { pops: 0, pooled };
}

/** Pour the previous week's day-relative template, pop failures, re-place. */
function pourTemplate(
  ctx: WeekCtx,
  template: Map<string, { weekday: number; ordinal: number } | null>,
  budget: { M: number; J: number; JPolish: number }
): { pops: number; pooled: number } {
  const byDate = new Map<ISODate, Array<{ uid: string; ordinal: number }>>();
  const leftovers: Item[] = [];
  for (const item of ctx.movable) {
    const t = template.get(templateKeyOf(item, isoWeekday(item.slot.date)));
    if (t === undefined) {
      leftovers.push(item);
      continue;
    }
    if (t === null) {
      if (!item.slot.optional) leftovers.push(item);
      continue; // intentionally dropped optional stays dropped
    }
    const date = addDays(ctx.monday, t.weekday - 1);
    if (!(ctx.candDays.get(item.slot.uid) ?? []).includes(date) || dayBlocked(ctx, item, date)) {
      leftovers.push(item);
      continue;
    }
    const arr = byDate.get(date) ?? [];
    arr.push({ uid: item.slot.uid, ordinal: t.ordinal });
    byDate.set(date, arr);
  }
  for (const [date, entries] of byDate) {
    entries.sort((a, b) => a.ordinal - b.ordinal || (a.uid < b.uid ? -1 : 1));
    ctx.state.pour(date, entries.map((e) => e.uid));
  }
  const popped = ctx.state.reflowAll();
  return finishPour(ctx, leftovers, popped, budget);
}

/** Week-1 warm start: pour the previously published positions by uid. */
function pourHint(
  ctx: WeekCtx,
  hint: Map<string, { date: ISODate; clockMin: number }>,
  budget: { M: number; J: number; JPolish: number }
): { pops: number; pooled: number } {
  const byDate = new Map<ISODate, Array<{ uid: string; ordinal: number }>>();
  const leftovers: Item[] = [];
  for (const item of ctx.movable) {
    const h = hint.get(item.slot.uid);
    if (!h || !(ctx.candDays.get(item.slot.uid) ?? []).includes(h.date) || dayBlocked(ctx, item, h.date)) {
      if (!item.slot.optional || (h && !item.slot.optional)) {
        if (!item.slot.optional) leftovers.push(item);
        else if (h) leftovers.push(item); // was published; try to keep it
      }
      continue;
    }
    const arr = byDate.get(h.date) ?? [];
    arr.push({ uid: item.slot.uid, ordinal: h.clockMin });
    byDate.set(h.date, arr);
  }
  for (const [date, entries] of byDate) {
    entries.sort((a, b) => a.ordinal - b.ordinal || (a.uid < b.uid ? -1 : 1));
    ctx.state.pour(date, entries.map((e) => e.uid));
  }
  const popped = ctx.state.reflowAll();
  return finishPour(ctx, leftovers, popped, budget);
}

/** Shared pour tail: re-place pops/leftovers via P1, rescue, lock, polish. */
function finishPour(
  ctx: WeekCtx,
  leftovers: Item[],
  popped: string[],
  budget: { M: number; J: number; JPolish: number }
): { pops: number; pooled: number } {
  const rePlace = [...leftovers, ...popped.map((uid) => ctx.itemByUid.get(uid)!)];
  rePlace.sort(
    (a, b) => (b.intent.priority ?? 0) - (a.intent.priority ?? 0) || (a.slot.uid < b.slot.uid ? -1 : 1)
  );
  let pool: Item[] = [];
  for (const item of rePlace) {
    if (!placeBest(ctx, item)) {
      if (item.slot.optional) continue; // dropped is a legal optional outcome
      pool.push(item);
    }
  }
  if (pool.length > 0) pool = rescue(ctx, pool, () => true, budget.M);
  const pooled = pool.length;
  for (const item of pool) hardPlace(ctx, item);
  optimize(ctx, budget.JPolish);
  return { pops: popped.length + leftovers.length, pooled };
}

/** Record the FINAL arrangement as next week's template. */
function recordTemplate(
  items: Item[],
  movable: Item[],
  placedByUid: Map<string, Placement>
): Map<string, { weekday: number; ordinal: number } | null> {
  const template = new Map<string, { weekday: number; ordinal: number } | null>();
  // Ordinal = rank by start among the movable members sharing the placed date.
  const byDate = new Map<ISODate, Placement[]>();
  const movableUids = new Set(movable.map((i) => i.slot.uid));
  for (const item of movable) {
    const p = placedByUid.get(item.slot.uid);
    if (!p) continue;
    const arr = byDate.get(p.date) ?? [];
    arr.push(p);
    byDate.set(p.date, arr);
  }
  const ordinalOf = new Map<string, number>();
  for (const arr of byDate.values()) {
    arr.sort((a, b) => a.startMin - b.startMin || (a.slot.uid < b.slot.uid ? -1 : 1));
    arr.forEach((p, i) => ordinalOf.set(p.slot.uid, i));
  }
  for (const item of items) {
    if (!movableUids.has(item.slot.uid)) continue;
    const p = placedByUid.get(item.slot.uid);
    template.set(
      templateKeyOf(item, isoWeekday(item.slot.date)),
      p ? { weekday: isoWeekday(p.date), ordinal: ordinalOf.get(item.slot.uid) ?? 0 } : null
    );
  }
  return template;
}
