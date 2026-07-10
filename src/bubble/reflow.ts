/**
 * The reflow engine — the bubble solver's correctness heart.
 *
 * Given ONE day's obstacles and an ORDERED bubble list, reflow always starts
 * fresh: every bubble at its floor duration, earliest-packed (hopping over
 * obstacles), then durations grow toward their maxima with priorities as flex
 * weights. Ordering is the only input degree of freedom — start times and
 * durations are re-derived on every call, which is what lets a caller try an
 * event at every insertion ordinal and simply compare outcomes.
 *
 * Everything is integer minutes in the day's LOCAL coordinates; values may be
 * negative or exceed 1440 (midnight spillover — never clamp). Starts snap UP
 * to the grid; durations do NOT snap (marker edges like sunset are off-grid —
 * the "watch sunset never fills" lesson).
 */

export interface ReflowBubble {
  /** Rigid core (floor) and elastic reach (max ≥ floor), minutes. */
  floor: number;
  max: number;
  /** Earliest legal START (band start for per_day stacks; sleep-trimmed). */
  notBefore: number;
  /** Latest legal END (window end; sleep-capped when discretion exists). */
  notAfter: number;
  /** Pinned start: position fixed, growth extends the end forward. */
  startsAt: number | null;
  /** Pinned end: end fixed, growth extends the start BACKWARD. */
  endsAt: number | null;
  /** Flex weight (priority + 1). */
  weight: number;
}

export interface ReflowOptions {
  grid: number;
  padding: number;
  /** Sorted-by-start [startMin, endMin) obstacle intervals (may exceed [0,1440)). */
  obstacles: Array<[number, number]>;
}

export type ReflowResult =
  | { ok: true; starts: number[]; durations: number[]; weightedDuration: number; utility: number }
  | { ok: false; violator: number };

/**
 * Concave per-bubble utility: floor minutes at full weight, growth minutes at
 * diminishing value (f(x) = x(2−x): marginal value 2w at the floor, 0 at max).
 * Candidate orderings are compared by Σ weight×u — so an ordering that starves
 * one flexible event to its floor loses to one that shares slack fairly, even
 * when the starving order squeezes a few more raw minutes into a dead pocket
 * (the "weekend dinner squished for no reason" report).
 */
export function bubbleUtility(b: ReflowBubble, d: number): number {
  if (b.max <= b.floor) return b.weight * d;
  const x = Math.min(1, Math.max(0, (d - b.floor) / (b.max - b.floor)));
  return b.weight * (b.floor + (b.max - b.floor) * x * (2 - x));
}

function ceilTo(value: number, step: number): number {
  return Math.ceil(value / step) * step;
}

/**
 * Minimal forward layout at the given durations. Returns start positions, or
 * the index of the first bubble that cannot legally fit under this ordering.
 */
function layout(bubbles: ReflowBubble[], durations: number[], opts: ReflowOptions): number[] | number {
  const { grid, padding, obstacles } = opts;
  const starts: number[] = new Array(bubbles.length);
  let cursor = -Infinity; // earliest allowed start for the next bubble
  for (let i = 0; i < bubbles.length; i++) {
    const b = bubbles[i];
    const d = durations[i];
    let s: number;
    if (b.startsAt !== null) {
      s = b.startsAt;
      if (s < cursor || collides(s, d, obstacles, padding)) return i;
    } else if (b.endsAt !== null) {
      s = b.endsAt - d;
      if (s < cursor || s < b.notBefore || collides(s, d, obstacles, padding)) return i;
    } else {
      s = ceilTo(Math.max(b.notBefore, cursor === -Infinity ? b.notBefore : cursor), grid);
      // Hop obstacles: s only ever increases, so one forward scan suffices.
      for (const [os, oe] of obstacles) {
        if (oe + padding <= s) continue; // fully behind
        if (s + d + padding <= os) break; // fully ahead (sorted by start)
        s = ceilTo(oe + padding, grid);
      }
    }
    if (s + d > b.notAfter || s < b.notBefore) return i;
    starts[i] = s;
    cursor = s + d + padding;
  }
  return starts;
}

/** True when [s, s+d) comes within `padding` of any obstacle. */
function collides(s: number, d: number, obstacles: Array<[number, number]>, padding: number): boolean {
  for (const [os, oe] of obstacles) {
    if (s + d + padding <= os) break; // sorted by start
    if (s < oe + padding && s + d + padding > os) return true;
  }
  return false;
}

/**
 * Reflow = fresh minimal layout + priority-weighted growth.
 *
 * Growth is weighted round-robin water-filling: each round credits every
 * unsaturated bubble by its weight; a bubble whose credit reaches the round's
 * max weight spends it on ONE grid unit of growth (validated by an O(k)
 * re-layout — pushes route over obstacles and window breaks reject the
 * increment). The final increment may be smaller than a grid unit so a
 * duration can land exactly on an off-grid cap. A bubble saturates at its
 * max, or when no increment of any size fits. Deterministic; terminates
 * because every attempt either grows a bounded duration or saturates.
 */
export function reflow(bubbles: ReflowBubble[], opts: ReflowOptions): ReflowResult {
  const durations = bubbles.map((b) => b.floor);
  let starts = layout(bubbles, durations, opts);
  if (typeof starts === 'number') return { ok: false, violator: starts };

  const saturated = bubbles.map((b) => b.max <= b.floor);
  const credits = new Array(bubbles.length).fill(0);
  for (;;) {
    let wmax = 0;
    for (let i = 0; i < bubbles.length; i++) if (!saturated[i] && bubbles[i].weight > wmax) wmax = bubbles[i].weight;
    if (wmax === 0) break; // everyone saturated
    for (let i = 0; i < bubbles.length; i++) {
      if (saturated[i]) continue;
      credits[i] += bubbles[i].weight;
      if (credits[i] < wmax) continue;
      credits[i] -= wmax;
      // Largest feasible increment ≤ min(grid, room-to-max); trying g, g−1, …
      // finds off-grid caps exactly (≤ grid probes, each an O(k) layout).
      let grew = false;
      for (let g = Math.min(opts.grid, bubbles[i].max - durations[i]); g >= 1; g--) {
        durations[i] += g;
        const r = layout(bubbles, durations, opts);
        if (typeof r !== 'number') {
          starts = r;
          grew = true;
          break;
        }
        durations[i] -= g;
      }
      if (!grew) saturated[i] = true;
      if (durations[i] >= bubbles[i].max) saturated[i] = true;
    }
  }

  let weightedDuration = 0;
  let utility = 0;
  for (let i = 0; i < bubbles.length; i++) {
    weightedDuration += bubbles[i].weight * durations[i];
    utility += bubbleUtility(bubbles[i], durations[i]);
  }
  return { ok: true, starts: starts as number[], durations, weightedDuration, utility };
}
