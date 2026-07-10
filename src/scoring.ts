/**
 * The shared lexicographic quality vector: every engine (MIP stages, bubble
 * acceptance, template-adoption gates, the A/B oracle) MUST score through this
 * one function — a re-implementation that diverges in the doubling exemption
 * or the padding-shortfall formula makes gates disagree with what tests assert.
 */
import { Item, Construction, Placement, occFor } from './solver';
import { GlobalConfig } from './types';
import { ISODate, absoluteMinutes } from './time';
import { resolveSleepBlackout } from './markers';

export interface ArrangementEntry {
  item: Item;
  pos: { date: ISODate; startMin: number; durationMin: number } | null;
}

/**
 * Score a week arrangement on [doubling, overlap, sleep, padding,
 * −placedCount, −totalDuration] against the rest of the calendar — the same
 * lexicographic order as the solver's stages, so adoption decisions and solved
 * results are directly comparable.
 */
export function scoreProposals(arr: ArrangementEntry[], items: Item[], c: Construction, config: GlobalConfig): number[] {
  const uidSet = new Set(items.map((i) => i.slot.uid));
  const mine = arr
    .filter((p) => p.pos)
    .map((p) => ({
      item: p.item,
      startAbs: absoluteMinutes(c.origin, p.pos!.date, p.pos!.startMin),
      endAbs: absoluteMinutes(c.origin, p.pos!.date, p.pos!.startMin + p.pos!.durationMin),
      pos: p.pos!,
    }));
  // Only intervals within a day (+padding) of the week's own range can
  // contribute to any tier (overlap needs intersection; padding shortfall
  // needs a gap under `padding` minutes) — everything else scores exactly
  // zero, so pre-filtering the horizon down to the neighborhood is
  // score-identical.
  const margin = 1440 + (config.padding ?? 0);
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of mine) {
    if (p.startAbs < lo) lo = p.startAbs;
    if (p.endAbs > hi) hi = p.endAbs;
  }
  lo -= margin;
  hi += margin;
  const others: Array<{ startAbs: number; endAbs: number }> = [];
  if (mine.length > 0) {
    for (const q of c.placements) {
      if (uidSet.has(q.slot.uid)) continue;
      const o = occFor(q, c.origin);
      if (o.endAbs > lo && o.startAbs < hi) others.push(o);
    }
    for (const f of c.fixedOccupied) if (f.endAbs > lo && f.startAbs < hi) others.push(f);
  }
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
export function scoreWeekArrangement(
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
