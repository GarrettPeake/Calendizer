/**
 * Deterministic PRNG for the bubble solver. Same input ⇒ same output is a
 * hard contract (diffUpdates 'unchanged', publish stability), so every
 * sampling decision flows from mulberry32 with a FIXED seed — never from
 * Math.random or wall-clock.
 */
export type Rng = () => number;

export const FIXED_SEED = 0xca1e0d1a;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Index sampled ∝ weights[i]; deterministic given the rng stream. */
export function pickWeighted(rng: Rng, weights: number[]): number {
  let total = 0;
  for (const w of weights) total += w;
  if (total <= 0) return 0;
  let r = rng() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r < 0) return i;
  }
  return weights.length - 1;
}

/** All indices in weighted order, sampled without replacement. */
export function weightedOrder(rng: Rng, weights: number[]): number[] {
  const remaining = weights.map((w, i) => ({ w, i }));
  const out: number[] = [];
  while (remaining.length > 0) {
    const k = pickWeighted(rng, remaining.map((r) => r.w));
    out.push(remaining[k].i);
    remaining.splice(k, 1);
  }
  return out;
}
