/**
 * Children (sub-event) tiling.
 *
 * Children fill the parent block contiguously, in declared order, with NO
 * padding between siblings. Fixed-duration children take their minutes; weight
 * children absorb the leftover slack proportionally. At least one weight child
 * is required so the parent always tiles exactly whatever duration is chosen.
 */
import { Child } from './types';

export interface TiledChild {
  subject: string;
  startMin: number;
  endMin: number;
}

export function tileChildren(
  parentStart: number,
  parentDuration: number,
  children: Child[]
): TiledChild[] {
  const fixedTotal = children.reduce(
    (sum, c) => sum + ('duration' in c ? c.duration : 0),
    0
  );
  const weightChildren = children.filter((c) => 'weight' in c) as Array<{
    subject: string;
    weight: number;
  }>;
  const weightTotal = weightChildren.reduce((s, c) => s + c.weight, 0);
  let slack = Math.max(0, parentDuration - fixedTotal);

  // Pre-compute integer minute shares for weight children (last gets remainder).
  const weightShares = new Map<number, number>();
  let assigned = 0;
  weightChildren.forEach((c, i) => {
    let share: number;
    if (i === weightChildren.length - 1) {
      share = slack - assigned;
    } else {
      share = weightTotal > 0 ? Math.floor((slack * c.weight) / weightTotal) : 0;
      assigned += share;
    }
    // Identify by reference position.
    weightShares.set(children.indexOf(c as unknown as Child), Math.max(0, share));
  });

  const tiles: TiledChild[] = [];
  let cursor = parentStart;
  children.forEach((c, idx) => {
    const dur = 'duration' in c ? c.duration : weightShares.get(idx) ?? 0;
    tiles.push({ subject: c.subject, startMin: cursor, endMin: cursor + dur });
    cursor += dur;
  });
  return tiles;
}
