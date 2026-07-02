/**
 * MIP model builder: one ISO week of occurrences → a CPLEX-LP model (text) plus
 * a list of lexicographic objective stages.
 *
 * The model is deliberately readable — it is the debugging artifact. Variables:
 *   s{o}      start (minutes from local midnight of the assigned day, integer)
 *   g{o}      grid steps; s{o} = grid·g{o} keeps flexible starts grid-aligned
 *   d{o}      duration minutes (integer; [floor,max] under fillToMax, else fixed)
 *   a{o}_{k}  day-assignment binary — created ONLY for optional occurrences and
 *             day-mobile ones; a required single-day occurrence's presence is a
 *             constant 1 (no binary, no gate terms)
 *   z{i}_{j}  order binary for a movable pair (1 ⇒ i before j); elided when only
 *             one temporal order can be overlap-free (the impossible direction's
 *             constraint is omitted — the solver then pays inflated ov for it,
 *             biasing toward the clean-capable order)
 *   ov{i}_{j} raw overlap slack minutes for the pair (upper bound; exact unless nested)
 *   ps{i}_{j} padding-shortfall slack minutes for the pair
 *   zb/ovb/psb{o}_{b}  the same against a constant obstacle b
 *   m{o}      sleep-intrusion minutes (only where the window admits sleep)
 *   hab{o}    |s − habit target| (only where a habit target exists)
 *   dev{o}    |s − band/earliest preferred start| (the earliness tie-break)
 *
 * All big-M coefficients are TIGHT (derived from the window geometry), which is
 * what keeps branch-and-bound fast on these models.
 *
 * Semantics mirrored from the greedy contract:
 *   - Windows and duration floors are HARD; pins fix s (starts_at) or s+d
 *     (ends_at) and cap growth exactly as growInPlace does.
 *   - Overlap is RAW intersection (padding is a separate, lower tier) — matching
 *     overlapConflicts/repair accounting.
 *   - m is max(0, wake − s, s + d − sleep): exact unless an event out-spans the
 *     whole waking day (pathological; greedy's own trigger is boolean anyway).
 *   - Day-exclusivity is keyed by intentId: at most one occurrence of an intent
 *     moves onto a day, and never onto a day holding a native (slot.date)
 *     occurrence of the same intent; natives may stack (per_day).
 */
import { GlobalConfig } from '../types';
import { ISODate } from '../time';
import { resolveWindow, resolveSleepBlackout } from '../markers';
import { Item, ceilTo, trimBySleep } from '../solver';

/** One occurrence entering the model, with its candidate days inside the week. */
export interface WeekOccurrence {
  item: Item;
  /** Candidate dates (sorted). Single-day required occurrences get no binaries. */
  days: ISODate[];
  /** The greedy seed position (null for a dropped optional). Used to build the
   *  incumbent that lets ideal-valued stages skip their solve entirely. */
  seed: { date: ISODate; startMin: number; durationMin: number } | null;
  /** A placed optional entering a day (packing) model: treat as required. */
  forceRequired?: boolean;
}

/** A constant interval on a date; start/end may exceed [0,1440] (cross-midnight). */
export interface DayObstacle {
  date: ISODate;
  startMin: number;
  endMin: number;
  label: string;
}

export interface StageObjective {
  name: string;
  /** varName → integer coefficient. The stage minimizes Σ coeff·var. */
  terms: Map<string, number>;
  /**
   * The best value this stage could possibly reach (slacks at 0, maximization
   * terms at their upper bound). When the current incumbent (greedy seed, or a
   * previous stage's solution) already evaluates to this, the stage is pinned
   * and skipped without a solve.
   */
  ideal: number;
  /** Extra HiGHS options merged over the defaults for this stage's solve. */
  options?: Record<string, unknown>;
  /**
   * Freeze the pair-order binaries (z/zb) to the incumbent before solving this
   * stage. The sliding tiers (habit/earliness) never need to REORDER events —
   * order is decided by the contention and duration tiers — and without the
   * order binaries they reduce to grid-integer LPs that solve in milliseconds
   * instead of minutes.
   */
  fixOrder?: boolean;
}

export interface WeekModel {
  constraints: string[];
  bounds: string[];
  generals: string[];
  binaries: string[];
  /** Ordered lexicographic stages (empty-term stages are pre-filtered). */
  stages: StageObjective[];
  decode: OccurrenceVars[];
  /**
   * The greedy seed expressed as objective-variable values — the incumbent that
   * stage 1 starts from, so any stage the seed already solves ideally is
   * skipped. Contains every var referenced by stage terms (+ s/d/a).
   */
  seedValues: Map<string, number>;
}

export interface OccurrenceVars {
  occIndex: number;
  sVar: string;
  dVar: string;
  /** Day binaries; empty ⇒ the single fixed day below. */
  aVars: Array<{ name: string; date: ISODate }>;
  fixedDate: ISODate | null;
  optional: boolean;
}

/**
 * Bounded-effort search for the duration-growth tier: stop after N improving
 * incumbents (a deterministic count). Measured on a dense day: 6 incumbents ≈
 * 96% of the exact optimum in ~0.2s, vs 60s+ to prove the last few minutes.
 * Contention tiers are never bounded this way — they stay exact.
 */
const PACKING_OPTIONS: Record<string, unknown> = { mip_max_improving_sols: 6 };

/** A tiny linear-expression builder — keeps the big-M algebra sign-safe. */
class Lin {
  private parts: string[] = [];
  add(coeff: number, varName: string): this {
    if (coeff === 0) return this;
    this.parts.push(coeff >= 0 ? `+ ${coeff} ${varName}` : `- ${-coeff} ${varName}`);
    return this;
  }
  cmp(op: '>=' | '<=' | '=', rhs: number): string {
    return `${this.parts.join(' ')} ${op} ${rhs}`;
  }
}

const habitKeyOf = (item: Item) => `${item.slot.intentId}|${item.slot.perDayIndex}`;

export interface BuildInput {
  occ: WeekOccurrence[];
  obstacles: DayObstacle[];
  config: GlobalConfig;
  /** habitKey → modal start minutes from earlier (already final) weeks. */
  habit: Map<string, number>;
  /**
   * Which half of the two-phase solve this model serves.
   *  - 'week' (phase A): the JOINT contention model — day assignment across the
   *    week; stages overlap → sleep → padding → optionals. No dev/hab rows.
   *  - 'day' (phase B): the per-day PACKING model — single-day occurrences at
   *    fixed day assignment; stages overlap → sleep → padding → durations →
   *    habit → earliness. Contention stages are included so packing can never
   *    degrade what phase A achieved on that day (skip-at-ideal makes them
   *    free when the day is clean).
   * The split is what keeps the hard packing tiers tractable: after day
   * assignment every objective quantity is day-local, so 7 tiny models replace
   * one week-sized one.
   */
  phase: 'week' | 'day';
}

interface DayCtx {
  date: ISODate;
  /** Earliest possible occupied start / latest possible occupied end on the day. */
  nb: number;
  na: number;
  wake: number;
  sleep: number;
  /** The greedy contract's first probe position (band start, sleep-trimmed). */
  band: number;
}

export function buildWeekModel(input: BuildInput): WeekModel {
  const { occ, obstacles, config, habit, phase } = input;
  const grid = Math.max(1, config.grid);
  const padding = config.padding ?? 0;

  const constraints: string[] = [];
  const bounds: string[] = [];
  const generals: string[] = [];
  const binaries: string[] = [];
  const decode: OccurrenceVars[] = [];

  const ovTerms = new Map<string, number>();
  const sleepTerms = new Map<string, number>();
  const psTerms = new Map<string, number>();
  const optTerms = new Map<string, number>();
  const durTerms = new Map<string, number>();
  const habTerms = new Map<string, number>();
  const devTerms = new Map<string, number>();
  const seedValues = new Map<string, number>();
  let optIdeal = 0;
  let durIdeal = 0;

  const dayCtx: DayCtx[][] = occ.map((o) => o.days.map((date) => dayCtxFor(o.item, date, config, grid)));
  /** Latest possible occupied end across ALL candidate days (for gate Ms). */
  const maxEnd: number[] = dayCtx.map((ctxs) => Math.max(...ctxs.map((c) => c.na)));
  /** Effective duration upper bound per occurrence (filled in the loop below). */
  const dHiOf: number[] = new Array(occ.length).fill(0);

  occ.forEach((o, oi) => {
    const it = o.item;
    const optional = !!it.slot.optional && !o.forceRequired;
    const w = (it.intent.priority ?? 0) + 1;
    const [dMin, dMax] = it.intent.duration;
    const flexDur = !!config.fillToMax && dMax > dMin;
    const sVar = `s${oi}`;
    const dVar = `d${oi}`;
    const multiDay = o.days.length > 1;
    const needsA = optional || multiDay;
    const aVars = needsA ? o.days.map((date, k) => ({ name: `a${oi}_${k}`, date })) : [];
    decode.push({ occIndex: oi, sVar, dVar, aVars, fixedDate: needsA ? null : o.days[0], optional });
    for (const a of aVars) binaries.push(a.name);

    // Incumbent (greedy seed) values.
    const seed = o.seed;
    seedValues.set(sVar, seed ? seed.startMin : 0);
    seedValues.set(dVar, seed ? seed.durationMin : 0);
    for (const a of aVars) seedValues.set(a.name, seed && a.date === seed.date ? 1 : 0);

    if (needsA) {
      const day = new Lin();
      for (const a of aVars) day.add(1, a.name);
      constraints.push(`day${oi}: ${day.cmp(optional ? '<=' : '=', 1)}`);
    }

    // Duration range. Pins cap growth by the same limits growInPlace uses
    // (window edge + sleep blackout as CONSTANTS; obstacles are the overlap
    // tier's job).
    let dHi = flexDur ? dMax : dMin;

    const rw0 = resolveWindow(it.intent.window, it.slot.date, config);
    const bl0 = resolveSleepBlackout(it.slot.date, config);
    if (it.pinned && !it.endPinned) {
      const c = rw0.startsAt as number;
      bounds.push(`${c} <= ${sVar} <= ${c}`);
      if (flexDur) {
        let limit = rw0.notAfter;
        if (c < bl0.sleepStart) limit = Math.min(limit, bl0.sleepStart);
        dHi = Math.max(dMin, Math.min(dMax, limit - c));
      }
    } else if (it.endPinned) {
      const E = rw0.endsAt as number;
      if (flexDur) {
        let limit = rw0.notBefore;
        if (E > bl0.wakeStart) limit = Math.max(limit, bl0.wakeStart);
        dHi = Math.max(dMin, Math.min(dMax, E - limit));
      }
      constraints.push(`endpin${oi}: ${new Lin().add(1, sVar).add(1, dVar).cmp('=', E)}`);
      bounds.push(`${Math.min(0, E - dHi)} <= ${sVar} <= ${Math.max(0, E)}`);
    } else {
      // Grid alignment via integer step var.
      const gVar = `g${oi}`;
      constraints.push(`grid${oi}: ${new Lin().add(1, sVar).add(-grid, gVar).cmp('=', 0)}`);
      bounds.push(`0 <= ${gVar} <= ${Math.ceil(2880 / grid)}`);
      generals.push(gVar);
      if (needsA) {
        // Window bounds depend on the chosen day: s ≥ Σ nb_k·a, s + d ≤ Σ na_k·a.
        const wlo = new Lin().add(1, sVar);
        const whi = new Lin().add(1, sVar).add(1, dVar);
        dayCtx[oi].forEach((dc, k) => {
          wlo.add(-dc.nb, aVars[k].name);
          whi.add(-dc.na, aVars[k].name);
        });
        constraints.push(`wlo${oi}: ${wlo.cmp('>=', 0)}`);
        constraints.push(`whi${oi}: ${whi.cmp('<=', 0)}`);
        bounds.push(`0 <= ${sVar} <= 2880`);
      } else {
        const dc = dayCtx[oi][0];
        bounds.push(`${Math.max(0, dc.nb)} <= ${sVar} <= ${Math.max(0, dc.na)}`);
        constraints.push(`whi${oi}: ${new Lin().add(1, sVar).add(1, dVar).cmp('<=', dc.na)}`);
      }
    }
    generals.push(sVar, dVar);

    dHiOf[oi] = dHi;

    // Duration bounds. Optionals relax to 0 when unplaced (d ∈ [floor·Σa, hi·Σa]).
    if (optional) {
      bounds.push(`0 <= ${dVar} <= ${dHi}`);
      if (dMin > 0) {
        const dfl = new Lin().add(1, dVar);
        for (const a of aVars) dfl.add(-dMin, a.name);
        constraints.push(`dfl${oi}: ${dfl.cmp('>=', 0)}`);
      }
      const dfh = new Lin().add(1, dVar);
      for (const a of aVars) dfh.add(-dHi, a.name);
      constraints.push(`dfh${oi}: ${dfh.cmp('<=', 0)}`);
    } else {
      bounds.push(`${dMin} <= ${dVar} <= ${dHi}`);
    }

    // Objective contributions (placement is phase A's call; growth phase B's).
    if (optional && phase === 'week') {
      for (const a of aVars) optTerms.set(a.name, -w);
      optIdeal -= w; // ideal: placed (one a at 1)
    }
    if (flexDur && phase === 'day') {
      durTerms.set(dVar, -w);
      durIdeal -= w * dHi;
    }

    // Sleep intrusion (skip pinned: their intrusion is fate, a constant).
    if (!it.pinned) {
      const admits = dayCtx[oi].some((dc) => dc.nb < dc.wake || dc.na > dc.sleep);
      if (admits) {
        const mVar = `m${oi}`;
        bounds.push(`0 <= ${mVar} <= 2880`);
        const slA = new Lin().add(1, mVar).add(1, sVar);
        const slB = new Lin().add(1, mVar).add(-1, sVar).add(-1, dVar);
        if (needsA) {
          dayCtx[oi].forEach((dc, k) => {
            slA.add(-dc.wake, aVars[k].name);
            slB.add(dc.sleep, aVars[k].name);
          });
          constraints.push(`slA${oi}: ${slA.cmp('>=', 0)}`);
          constraints.push(`slB${oi}: ${slB.cmp('>=', 0)}`);
        } else {
          const dc = dayCtx[oi][0];
          constraints.push(`slA${oi}: ${slA.cmp('>=', dc.wake)}`);
          constraints.push(`slB${oi}: ${slB.cmp('>=', -dc.sleep)}`);
        }
        sleepTerms.set(mVar, w);
        if (seed) {
          const dc = dayCtx[oi][o.days.indexOf(seed.date)];
          seedValues.set(mVar, Math.max(0, dc.wake - seed.startMin, seed.startMin + seed.durationMin - dc.sleep));
        } else {
          seedValues.set(mVar, 0);
        }
      }
    }

    // Habit |s − h| (gated so an unplaced optional pays nothing). Phase B only.
    const h = phase === 'day' ? habit.get(habitKeyOf(it)) : undefined;
    if (h !== undefined && !it.pinned) {
      const habVar = `hab${oi}`;
      bounds.push(`0 <= ${habVar} <= 2880`);
      constraints.push(`haA${oi}: ${new Lin().add(1, habVar).add(-1, sVar).cmp('>=', -h)}`);
      const haB = new Lin().add(1, habVar).add(1, sVar);
      if (optional) {
        for (const a of aVars) haB.add(-h, a.name);
        constraints.push(`haB${oi}: ${haB.cmp('>=', 0)}`);
      } else {
        constraints.push(`haB${oi}: ${haB.cmp('>=', h)}`);
      }
      habTerms.set(habVar, w);
      seedValues.set(habVar, seed ? Math.abs(seed.startMin - h) : 0);
    }

    // Earliness/band deviation |s − band_k| (the greedy-contract tie-break).
    // Phase B only.
    if (!it.pinned && phase === 'day') {
      const devVar = `dev${oi}`;
      bounds.push(`0 <= ${devVar} <= 2880`);
      const dvA = new Lin().add(1, devVar).add(-1, sVar);
      const dvB = new Lin().add(1, devVar).add(1, sVar);
      if (needsA) {
        dayCtx[oi].forEach((dc, k) => {
          dvA.add(dc.band, aVars[k].name);
          dvB.add(-dc.band, aVars[k].name);
        });
        constraints.push(`dvA${oi}: ${dvA.cmp('>=', 0)}`);
        constraints.push(`dvB${oi}: ${dvB.cmp('>=', 0)}`);
      } else {
        const dc = dayCtx[oi][0];
        constraints.push(`dvA${oi}: ${dvA.cmp('>=', -dc.band)}`);
        constraints.push(`dvB${oi}: ${dvB.cmp('>=', dc.band)}`);
      }
      devTerms.set(devVar, w);
      seedValues.set(devVar, seed ? Math.abs(seed.startMin - dayCtx[oi][o.days.indexOf(seed.date)].band) : 0);
    }
  });

  /** Day-presence of occurrence oi on candidate index k: var name or null (constant 1). */
  const presence = (oi: number, k: number): string | null => {
    const dec = decode[oi];
    return dec.aVars.length ? dec.aVars[k].name : null;
  };

  // --- Movable pairs: soft non-overlap + padding, per shared candidate day. ---
  for (let i = 0; i < occ.length; i++) {
    for (let j = i + 1; j < occ.length; j++) {
      const shared: Array<{ ki: number; kj: number; zmA: number; zmB: number }> = [];
      occ[i].days.forEach((di, ki) => {
        const kj = occ[j].days.indexOf(di);
        if (kj < 0) return;
        const ci = dayCtx[i][ki];
        const cj = dayCtx[j][kj];
        if (!(ci.nb < cj.na + padding && cj.nb < ci.na + padding)) return; // can't interact
        shared.push({
          ki,
          kj,
          zmA: Math.max(0, ci.na - cj.nb),
          zmB: Math.max(0, cj.na - ci.nb),
        });
      });
      if (shared.length === 0) continue;

      const wPair = (occ[i].item.intent.priority ?? 0) + (occ[j].item.intent.priority ?? 0) + 2;
      const ov = `ov${i}_${j}`;
      const ovMax = Math.max(...shared.map((s) => Math.max(s.zmA, s.zmB)));
      bounds.push(`0 <= ${ov} <= ${ovMax}`);
      ovTerms.set(ov, wPair);
      let ps: string | null = null;
      if (padding > 0) {
        ps = `ps${i}_${j}`;
        bounds.push(`0 <= ${ps} <= ${ovMax + padding}`);
        psTerms.set(ps, 1);
      }
      // Both directions are ALWAYS modeled (with the order binary). Eliding the
      // "can't be overlap-free" direction looks tempting, but under forced
      // overlap it misprices arrangements sitting in the elided direction (the
      // proxy then exceeds the true overlap), which can make a genuinely worse
      // schedule look better — a bug we hit, not a hypothetical.
      const z = `z${i}_${j}`;
      binaries.push(z);
      const emitA = true;
      const emitB = true;

      // Incumbent values for the pair slacks (matching the emitted rows) and
      // the order binary (z=1 ⇒ i before j; the cheaper direction).
      const si = occ[i].seed;
      const sj = occ[j].seed;
      if (si && sj && si.date === sj.date) {
        const vA = Math.max(0, si.startMin + si.durationMin - sj.startMin);
        const vB = Math.max(0, sj.startMin + sj.durationMin - si.startMin);
        seedValues.set(ov, Math.min(vA, vB));
        seedValues.set(z, vA <= vB ? 1 : 0);
        if (ps) {
          const pA = Math.max(0, padding + si.startMin + si.durationMin - sj.startMin);
          const pB = Math.max(0, padding + sj.startMin + sj.durationMin - si.startMin);
          seedValues.set(ps, Math.min(pA, pB));
        }
      } else {
        seedValues.set(ov, 0);
        seedValues.set(z, 0);
        if (ps) seedValues.set(ps, 0);
      }

      for (const { ki, kj, zmA, zmB } of shared) {
        // Direction A (i before j): s_j − s_i − d_i + slack ≥ pad, relaxed by
        // zm·(1−z) and, for day-mobile members, maxEnd·(1−a).
        const emit = (dir: 'A' | 'B', slackVar: string, pad: number, tag: string) => {
          const zm = (dir === 'A' ? zmA : zmB) + pad;
          const gm = (dir === 'A' ? maxEnd[i] : maxEnd[j]) + pad;
          const lin = new Lin();
          let rhs = pad;
          if (dir === 'A') lin.add(1, `s${j}`).add(-1, `s${i}`).add(-1, `d${i}`);
          else lin.add(1, `s${i}`).add(-1, `s${j}`).add(-1, `d${j}`);
          lin.add(1, slackVar);
          if (z) {
            if (dir === 'A') {
              lin.add(-zm, z); // active at z=1: rhs must include the −zm shift
              rhs -= zm;
            } else {
              lin.add(zm, z); // active at z=0
            }
          }
          const pi = presence(i, ki);
          const pj = presence(j, kj);
          if (pi) {
            lin.add(-gm, pi);
            rhs -= gm;
          }
          if (pj) {
            lin.add(-gm, pj);
            rhs -= gm;
          }
          constraints.push(`${tag}${i}_${j}_${ki}: ${lin.cmp('>=', rhs)}`);
        };
        if (emitA) {
          emit('A', ov, 0, 'poA');
          if (ps) emit('A', ps, padding, 'ppA');
        }
        if (emitB) {
          emit('B', ov, 0, 'poB');
          if (ps) emit('B', ps, padding, 'ppB');
        }
      }
    }
  }

  // --- Obstacle pairs: soft non-overlap + padding against constants. ---
  obstacles.forEach((b, bi) => {
    occ.forEach((o, oi) => {
      const k = o.days.indexOf(b.date);
      if (k < 0) return;
      const dc = dayCtx[oi][k];
      if (!(b.startMin < dc.na + padding && dc.nb < b.endMin + padding)) return;
      const w = (o.item.intent.priority ?? 0) + 102; // fixed events weigh as priority-100
      const zmA = Math.max(0, dc.na - b.startMin);
      const zmB = Math.max(0, b.endMin - dc.nb);
      // Both directions always modeled — see the pair-loop note on elision.
      const zb = `zb${oi}_${bi}`;
      binaries.push(zb);
      const ovb = `ovb${oi}_${bi}`;
      bounds.push(`0 <= ${ovb} <= ${Math.max(zmA, zmB)}`);
      ovTerms.set(ovb, w);
      let psb: string | null = null;
      if (padding > 0) {
        psb = `psb${oi}_${bi}`;
        bounds.push(`0 <= ${psb} <= ${Math.max(zmA, zmB) + padding}`);
        psTerms.set(psb, 1);
      }
      const pres = presence(oi, k);
      // Incumbent values for the obstacle slacks.
      {
        const so = o.seed;
        if (so && so.date === b.date) {
          const vA = Math.max(0, so.startMin + so.durationMin - b.startMin);
          const vB = Math.max(0, b.endMin - so.startMin);
          seedValues.set(ovb, Math.min(vA, vB));
          seedValues.set(zb, vA <= vB ? 1 : 0);
          if (psb) {
            const pA = Math.max(0, padding + so.startMin + so.durationMin - b.startMin);
            const pB = Math.max(0, padding + b.endMin - so.startMin);
            seedValues.set(psb, Math.min(pA, pB));
          }
        } else {
          seedValues.set(ovb, 0);
          seedValues.set(zb, 0);
          if (psb) seedValues.set(psb, 0);
        }
      }
      // Direction A (o before b): b.start − s − d + slack ≥ pad, relaxed by
      // (zmA+pad)(1−zb) and, when day-mobile, (maxEnd+pad)(1−a).
      const emitA = (slackVar: string, pad: number, tag: string) => {
        const lin = new Lin().add(-1, `s${oi}`).add(-1, `d${oi}`).add(1, slackVar);
        let rhs = pad - b.startMin;
        if (zb) {
          lin.add(-(zmA + pad), zb);
          rhs -= zmA + pad;
        }
        if (pres) {
          const gm = maxEnd[oi] + pad;
          lin.add(-gm, pres);
          rhs -= gm;
        }
        constraints.push(`${tag}${oi}_${bi}: ${lin.cmp('>=', rhs)}`);
      };
      // Direction B (o after b): s + slack ≥ b.end + pad, relaxed by
      // (zmB+pad)·zb and, when day-mobile, (b.end+pad)(1−a).
      const emitB = (slackVar: string, pad: number, tag: string) => {
        const lin = new Lin().add(1, `s${oi}`).add(1, slackVar);
        let rhs = pad + b.endMin;
        if (zb) lin.add(zmB + pad, zb);
        if (pres) {
          const gm = b.endMin + pad; // s ≥ 0 always, so gm covers the full deficit
          lin.add(-gm, pres);
          rhs -= gm;
        }
        constraints.push(`${tag}${oi}_${bi}: ${lin.cmp('>=', rhs)}`);
      };
      emitA(ovb, 0, 'boA');
      if (psb) emitA(psb, padding, 'bpA');
      emitB(ovb, 0, 'boB');
      if (psb) emitB(psb, padding, 'bpB');
    });
  });

  // --- Day-exclusivity by intentId. ---
  const byIntent = new Map<string, number[]>();
  occ.forEach((o, oi) => {
    const arr = byIntent.get(o.item.slot.intentId) ?? [];
    arr.push(oi);
    byIntent.set(o.item.slot.intentId, arr);
  });
  for (const [intentId, indices] of byIntent) {
    if (indices.length < 2) continue;
    const allDays = new Set<ISODate>();
    for (const oi of indices) for (const d of occ[oi].days) allDays.add(d);
    for (const d of [...allDays].sort()) {
      const movers = indices.filter(
        (oi) => occ[oi].item.slot.date !== d && occ[oi].days.includes(d) && decode[oi].aVars.length > 0
      );
      if (movers.length === 0) continue;
      const natives = indices.filter((oi) => occ[oi].item.slot.date === d && occ[oi].days.includes(d));
      const dTag = d.replace(/-/g, '');
      if (movers.length > 1) {
        const lin = new Lin();
        for (const oi of movers) lin.add(1, `a${oi}_${occ[oi].days.indexOf(d)}`);
        constraints.push(`xm_${slug(intentId)}_${dTag}: ${lin.cmp('<=', 1)}`);
      }
      for (const mo of movers) {
        for (const no of natives) {
          const noPres = presence(no, occ[no].days.indexOf(d));
          const lin = new Lin().add(1, `a${mo}_${occ[mo].days.indexOf(d)}`);
          if (noPres) {
            lin.add(1, noPres);
            constraints.push(`xn_${slug(intentId)}_${dTag}_${mo}_${no}: ${lin.cmp('<=', 1)}`);
          } else {
            // Native is fixed-present on d: the mover may never take d.
            constraints.push(`xn_${slug(intentId)}_${dTag}_${mo}_${no}: ${lin.cmp('<=', 0)}`);
          }
        }
      }
    }
  }

  // --- Capacity cuts (day models with duration growth only). ---
  // For any interval [L,U] built from window bounds: the members whose whole
  // legal range sits inside [L,U] can jointly occupy at most (U−L) minus the
  // obstacle span inside it — relaxed by their overlap slacks so the cut is
  // valid even for forced-overlap arrangements. Big-M relaxations are blind to
  // this; without the cuts the durations tier spends seconds proving what the
  // cut states outright.
  if (phase === 'day' && durTerms.size > 0 && occ.length > 1) {
    const date = occ[0].days[0];
    const merged: Array<[number, number]> = [];
    for (const b of [...obstacles.filter((b) => b.date === date)].sort((x, y) => x.startMin - y.startMin)) {
      const last = merged[merged.length - 1];
      if (last && b.startMin <= last[1]) last[1] = Math.max(last[1], b.endMin);
      else merged.push([b.startMin, b.endMin]);
    }
    const obsWithin = (L: number, U: number) =>
      merged.reduce((acc, [s, e]) => acc + Math.max(0, Math.min(U, e) - Math.max(L, s)), 0);
    const Ls = [...new Set(dayCtx.map((c) => c[0].nb))].sort((a, b) => a - b);
    const Us = [...new Set(dayCtx.map((c) => c[0].na))].sort((a, b) => a - b);
    let cutN = 0;
    for (const L of Ls) {
      for (const U of Us) {
        if (U <= L) continue;
        const members = occ.map((_, oi) => oi).filter((oi) => dayCtx[oi][0].nb >= L && dayCtx[oi][0].na <= U);
        if (members.length < 2) continue;
        const cap = U - L - obsWithin(L, U);
        const sumHi = members.reduce((acc, oi) => acc + dHiOf[oi], 0);
        if (sumHi <= cap) continue; // can never bind
        const inSet = new Set(members);
        const lin = new Lin();
        for (const oi of members) lin.add(1, `d${oi}`);
        // Relax by every overlap slack that could reclaim in-interval space.
        for (const [name] of ovTerms) {
          const m = /^ov(\d+)_(\d+)$/.exec(name);
          if (m && inSet.has(Number(m[1])) && inSet.has(Number(m[2]))) lin.add(-1, name);
          const mb = /^ovb(\d+)_(\d+)$/.exec(name);
          if (mb && inSet.has(Number(mb[1]))) lin.add(-1, name);
        }
        constraints.push(`cap${cutN++}: ${lin.cmp('<=', cap)}`);
      }
    }
  }

  const stages: StageObjective[] = (
    phase === 'week'
      ? [
          { name: 'overlap', terms: ovTerms, ideal: 0 },
          { name: 'sleep', terms: sleepTerms, ideal: 0 },
          { name: 'padding', terms: psTerms, ideal: 0 },
          // Placement of aspirational extras is a maximization with the same
          // prove-the-last-one hardness as durations — bound it the same way.
          { name: 'optionals', terms: optTerms, ideal: optIdeal, options: PACKING_OPTIONS },
        ]
      : [
          { name: 'overlap', terms: ovTerms, ideal: 0 },
          { name: 'sleep', terms: sleepTerms, ideal: 0 },
          { name: 'padding', terms: psTerms, ideal: 0 },
          // The packing tiers are quality/aesthetic refinements over a schedule
          // whose contention is already pinned — a near-optimal incumbent is
          // indistinguishable in practice, and closing the last few grid-minutes
          // of a weak big-M gap can take seconds per day. Stop when the
          // incumbent stalls (a deterministic NODE count, not wall-clock).
          { name: 'durations', terms: durTerms, ideal: durIdeal, options: PACKING_OPTIONS },
          { name: 'habit', terms: habTerms, ideal: 0, fixOrder: true },
          { name: 'earliness', terms: devTerms, ideal: 0, fixOrder: true },
        ]
  ).filter((s) => s.terms.size > 0);

  return { constraints, bounds, generals, binaries, stages, decode, seedValues };
}

function dayCtxFor(item: Item, date: ISODate, config: GlobalConfig, grid: number): DayCtx {
  const rw = resolveWindow(item.intent.window, date, config);
  const { sleepStart, wakeStart } = resolveSleepBlackout(date, config);
  const dReach = config.fillToMax ? item.intent.duration[1] : item.intent.duration[0];
  if (item.pinned && !item.endPinned) {
    // nb/na = the interval this pin can possibly occupy (start fixed, may grow).
    const s = rw.startsAt as number;
    return { date, nb: s, na: s + dReach, wake: wakeStart, sleep: sleepStart, band: s };
  }
  if (item.endPinned) {
    const e = rw.endsAt as number;
    return { date, nb: e - dReach, na: e, wake: wakeStart, sleep: sleepStart, band: e - item.intent.duration[0] };
  }
  const floor = item.intent.duration[0];
  const lo = ceilTo(rw.notBefore, grid);
  const hi = rw.notAfter - floor;
  // Band start: the greedy contract's first probe (per_day banding, sleep-trimmed).
  let bandLo = lo;
  let bandHi = hi;
  const { perDayIndex, perDayCount } = item.slot;
  if (perDayCount > 1 && hi >= lo) {
    const span = hi - lo;
    bandLo = ceilTo(lo + Math.floor((span * perDayIndex) / perDayCount), grid);
    bandHi = lo + Math.floor((span * (perDayIndex + 1)) / perDayCount);
    if (bandLo > hi) bandLo = lo;
    if (bandHi < bandLo) bandHi = hi;
  }
  const trimmed = trimBySleep(bandLo, bandHi, floor, date, config);
  const band = ceilTo(trimmed ? trimmed[0] : bandLo, grid);
  return { date, nb: rw.notBefore, na: rw.notAfter, wake: wakeStart, sleep: sleepStart, band };
}

function slug(s: string): string {
  return s.replace(/[^A-Za-z0-9]/g, '_');
}
