/**
 * Blocker semantics — a post-solve, engine-independent pass.
 *
 * A blocker intent (e.g. "Work" 9–5) reserves time like any other intent: the
 * solvers place it and schedule everything else around it at full priority.
 * But its occurrences are scenery, not events — drawn as a shaded area on the
 * calendar, excluded from the ICS feed — and an event forced to overlap one is
 * LABELED (`Instance.blockedBy`, like `placedDuringSleep`) rather than
 * reported as a conflict.
 *
 * Applied in `assembleOutput` (both engines) so every SolveOutput carries the
 * semantics, and RE-applied wherever instances come back from storage that
 * drops derived fields (the D1 frozen-past table) — it re-derives everything
 * from the intent set, so it is idempotent and self-correcting.
 */
import { ConflictReport, Instance, Intent } from './types';
import { slugify } from './expand';

export function applyBlockerSemantics(
  instances: Instance[],
  conflicts: ConflictReport[],
  intents: Intent[]
): { instances: Instance[]; conflicts: ConflictReport[] } {
  const blockers = intents.filter((i) => i.blocker);
  if (blockers.length === 0) return { instances, conflicts };

  // Instances key by intentId (which defaults to a subject slug at expansion);
  // conflict reports name subjects.
  const ids = new Set(blockers.map((i) => i.id ?? slugify(i.subject)));
  const subjects = new Set(blockers.map((i) => i.subject));

  const zones = instances.filter((i) => ids.has(i.intentId));
  const out = instances.map((inst) => {
    if (ids.has(inst.intentId)) {
      return inst.blocker ? inst : { ...inst, blocker: true };
    }
    const hits = [
      ...new Set(zones.filter((z) => inst.start < z.end && z.start < inst.end).map((z) => z.subject)),
    ];
    if (hits.length === 0) {
      if (!inst.blockedBy) return inst;
      const { blockedBy: _stale, ...rest } = inst; // stale label from storage
      return rest;
    }
    return { ...inst, blockedBy: hits };
  });

  return {
    instances: out,
    // Only OVERLAP conflicts are absorbed — a blocker that is itself
    // unplaceable (window-unsatisfiable, floor-unmet) is still a real problem.
    conflicts: conflicts.filter((c) => !(c.kind === 'overlap' && c.involved.some((s) => subjects.has(s)))),
  };
}
