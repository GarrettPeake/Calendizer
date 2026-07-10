/**
 * WeekState: one ISO week's mutable arrangement for the bubble solver — the
 * ordered bubble sequence per date, trial insertion at every ordinal, commits
 * that write real Placements (mutating existing objects IN PLACE so the
 * Construction's placement array stays coherent for cross-week scoring), and
 * the lexicographic placement heuristic.
 */
import { Item, Placement, Construction, occFor, isInSleep, orderItems } from '../solver';
import { GlobalConfig } from '../types';
import { ISODate } from '../time';
import { projectToDays } from '../weekShared';
import { reflow, ReflowBubble } from './reflow';
import { bubbleFor } from './timeline';

export interface TrialResult {
  date: ISODate;
  ordinal: number;
  /** Post-reflow Σ weight×duration on the affected day. */
  weightedDuration: number;
  /** Post-reflow Σ weight×start — the earliness tiebreak (lower is better). */
  weightedStart: number;
  starts: number[];
  durations: number[];
}

/** Placement-candidate comparison, lexicographic (see plan §1.3). */
export interface CandidateScore {
  deltaWeighted: number; // maximize
  nativeDay: number; // 0 = native, 1 = not (minimize)
  load: number; // minimize
  habitDist: number; // minimize
  earliness: number; // minimize
  dayIndex: number; // deterministic tiebreak
  ordinal: number;
}

export function betterCandidate(a: CandidateScore, b: CandidateScore): boolean {
  if (a.deltaWeighted !== b.deltaWeighted) return a.deltaWeighted > b.deltaWeighted;
  if (a.nativeDay !== b.nativeDay) return a.nativeDay < b.nativeDay;
  if (a.load !== b.load) return a.load < b.load;
  if (a.habitDist !== b.habitDist) return a.habitDist < b.habitDist;
  if (a.earliness !== b.earliness) return a.earliness < b.earliness;
  if (a.dayIndex !== b.dayIndex) return a.dayIndex < b.dayIndex;
  return a.ordinal < b.ordinal;
}

export class WeekState {
  /** Ordered movable uids per date — the only degree of freedom. */
  private seq = new Map<ISODate, string[]>();
  /** Cached per-date obstacle lists; invalidated when the model set changes. */
  private obstacles: Map<ISODate, Array<[number, number]>> | null = null;
  /** Cached per-(uid,date) bubbles — pure function of (item, date, config). */
  private bubbleCache = new Map<string, ReflowBubble | null>();

  constructor(
    readonly dates: ISODate[],
    readonly itemByUid: Map<string, Item>,
    /** Uids the solver may arrange; everything else is terrain. */
    readonly modelUids: Set<string>,
    private readonly placedByUid: Map<string, Placement>,
    private readonly c: Construction,
    private readonly config: GlobalConfig
  ) {
    for (const d of dates) this.seq.set(d, []);
  }

  /** Replace a date's sequence wholesale (template pour); placements are NOT
   *  written until reflowAll() validates each day. */
  pour(date: ISODate, uids: string[]): void {
    if (this.seq.has(date)) this.seq.set(date, [...uids]);
  }

  snapshotSeq(): Map<ISODate, string[]> {
    const out = new Map<ISODate, string[]>();
    for (const [d, uids] of this.seq) out.set(d, [...uids]);
    return out;
  }

  restoreSeq(snap: Map<ISODate, string[]>): void {
    for (const [d, uids] of snap) this.seq.set(d, [...uids]);
  }

  /** The model set shrank (P3 lock) — placements outside it become terrain. */
  invalidateObstacles(): void {
    this.obstacles = null;
  }

  private obstaclesFor(date: ISODate): Array<[number, number]> {
    if (!this.obstacles) {
      const abs: Array<{ startAbs: number; endAbs: number; label: string }> = [];
      for (const f of this.c.fixedOccupied) abs.push(f);
      for (const p of this.placedByUid.values()) {
        if (this.modelUids.has(p.slot.uid)) continue;
        abs.push(occFor(p, this.c.origin));
      }
      this.obstacles = new Map();
      for (const d of this.dates) this.obstacles.set(d, []);
      for (const iv of projectToDays(this.dates, abs, this.c.origin)) {
        this.obstacles.get(iv.date)?.push([iv.startMin, iv.endMin]);
      }
    }
    return this.obstacles.get(date) ?? [];
  }

  bubbleOn(uid: string, date: ISODate): ReflowBubble | null {
    const key = `${uid}|${date}`;
    let b = this.bubbleCache.get(key);
    if (b === undefined) {
      b = bubbleFor(this.itemByUid.get(uid)!, date, this.config);
      this.bubbleCache.set(key, b);
    }
    return b;
  }

  sequenceOf(date: ISODate): readonly string[] {
    return this.seq.get(date) ?? [];
  }

  /** Σ placed minutes on a date (movable members only) — the load tiebreak. */
  loadOf(date: ISODate): number {
    let total = 0;
    for (const uid of this.sequenceOf(date)) total += this.placedByUid.get(uid)?.durationMin ?? 0;
    return total;
  }

  /** Reflow a date's current sequence; returns null when the ordering is invalid. */
  private reflowDay(
    date: ISODate,
    uids: string[]
  ): { starts: number[]; durations: number[]; weightedDuration: number; weightedStart: number } | null {
    const bubbles: ReflowBubble[] = [];
    for (const uid of uids) {
      const b = this.bubbleOn(uid, date);
      if (!b) return null;
      bubbles.push(b);
    }
    const r = reflow(bubbles, {
      grid: Math.max(1, this.config.grid),
      padding: this.config.padding ?? 0,
      obstacles: this.obstaclesFor(date),
    });
    if (!r.ok) return null;
    let weightedStart = 0;
    for (let i = 0; i < bubbles.length; i++) weightedStart += bubbles[i].weight * r.starts[i];
    return { starts: r.starts, durations: r.durations, weightedDuration: r.weightedDuration, weightedStart };
  }

  /** Current post-reflow weighted duration of a date (0 for an empty day). */
  weightedOf(date: ISODate): number {
    const uids = this.seq.get(date) ?? [];
    if (uids.length === 0) return 0;
    let total = 0;
    for (const uid of uids) {
      const p = this.placedByUid.get(uid);
      const b = this.bubbleOn(uid, date);
      if (p && b) total += b.weight * p.durationMin;
    }
    return total;
  }

  /** Try `uid` at every ordinal of `date`; best (max weightedDuration) or
   *  null. Ties resolve to the CANONICAL ordinal — the stable-insertion
   *  position under orderItems (priority desc, alphabetical tiebreak) — so
   *  same-window events stack in the contracted order; a tie candidate beats
   *  it only as a PARETO earliness improvement (nobody starts later, someone
   *  starts earlier — e.g. a sunrise event must not queue behind an evening
   *  one just because of the canonical order). */
  tryInsert(uid: string, date: ISODate): TrialResult | null {
    const cur = this.seq.get(date);
    if (cur === undefined || !this.bubbleOn(uid, date)) return null;
    const item = this.itemByUid.get(uid)!;
    let preferred = 0;
    for (const u of cur) if (orderItems(this.itemByUid.get(u)!, item) < 0) preferred++;
    const ordinals = Array.from({ length: cur.length + 1 }, (_, o) => o).sort(
      (a, b) => Math.abs(a - preferred) - Math.abs(b - preferred) || a - b
    );
    const startsByUid = (trial: string[], starts: number[]) => {
      const m = new Map<string, number>();
      trial.forEach((u, i) => m.set(u, starts[i]));
      return m;
    };
    let best: TrialResult | null = null;
    let bestStarts: Map<string, number> | null = null;
    for (const ordinal of ordinals) {
      const trial = [...cur.slice(0, ordinal), uid, ...cur.slice(ordinal)];
      const r = this.reflowDay(date, trial);
      if (!r) continue;
      let take = !best || r.weightedDuration > best.weightedDuration;
      if (!take && best && r.weightedDuration === best.weightedDuration && bestStarts) {
        const mine = startsByUid(trial, r.starts);
        let someEarlier = false;
        let noneLater = true;
        for (const [u, s] of mine) {
          const b = bestStarts.get(u)!;
          if (s < b) someEarlier = true;
          else if (s > b) noneLater = false;
        }
        take = someEarlier && noneLater;
      }
      if (take) {
        best = { date, ordinal, ...r };
        bestStarts = startsByUid(trial, r.starts);
      }
    }
    return best;
  }

  /** Commit an insertion trial: splice the sequence and write placements. */
  commitInsert(uid: string, trial: TrialResult): void {
    const uids = this.seq.get(trial.date)!;
    uids.splice(trial.ordinal, 0, uid);
    this.writeDay(trial.date, uids, trial.starts, trial.durations);
  }

  /** Remove `uid` from its date (if placed) and re-pack that day. */
  remove(uid: string): ISODate | null {
    const p = this.placedByUid.get(uid);
    if (!p) return null;
    const date = p.date;
    const uids = this.seq.get(date);
    if (!uids) return null;
    const at = uids.indexOf(uid);
    if (at < 0) return null;
    uids.splice(at, 1);
    this.placedByUid.delete(uid);
    if (uids.length > 0) {
      const r = this.reflowDay(date, uids);
      // Removing only frees space; the remaining ordering stays valid.
      if (r) this.writeDay(date, uids, r.starts, r.durations);
    }
    return date;
  }

  /** Re-reflow every non-empty day (used after obstacle changes). Days whose
   *  ordering became invalid return their uids for re-placement (popped). */
  reflowAll(): string[] {
    const popped: string[] = [];
    for (const date of this.dates) {
      const uids = this.seq.get(date)!;
      if (uids.length === 0) continue;
      let r = this.reflowDay(date, uids);
      while (!r && uids.length > 0) {
        // Pop the first violator-adjacent uid deterministically: retry without
        // the LAST uid first (least-anchored suffix) until the day packs.
        popped.push(uids.pop()!);
        r = uids.length > 0 ? this.reflowDay(date, uids) : null;
      }
      if (r) this.writeDay(date, uids, r.starts, r.durations);
    }
    for (const uid of popped) this.placedByUid.delete(uid);
    return popped;
  }

  private writeDay(date: ISODate, uids: string[], starts: number[], durations: number[]): void {
    for (let i = 0; i < uids.length; i++) {
      const item = this.itemByUid.get(uids[i])!;
      const existing = this.placedByUid.get(uids[i]);
      const placement: Placement = existing ?? {
        slot: item.slot,
        intent: item.intent,
        date,
        startMin: starts[i],
        durationMin: durations[i],
        placedDuringSleep: false,
        pinned: item.pinned,
        endPinned: item.endPinned,
      };
      placement.date = date;
      placement.startMin = starts[i];
      placement.durationMin = durations[i];
      placement.placedDuringSleep = isInSleep(starts[i], durations[i], date, this.config);
      this.placedByUid.set(uids[i], placement);
    }
  }
}
