/**
 * Mode resolution: which intents are active on which dates.
 *
 *  - During a mode span the active set is intents whose mode === that mode's
 *    name OR === "all". `default` intents are suppressed for the span.
 *  - Outside any mode span the active set is `default` + `all`.
 *  - `all` intents run in every mode, always.
 *  - Modes do not overlap; overlaps are reported as conflicts.
 */
import { Mode, Intent, ConflictReport } from './types';
import { ISODate } from './time';

/**
 * Resolve an intent's mode reference to the NAME the solver expects. Intents may
 * reference a mode by id, by the reserved "default"/"all", or (legacy) by name;
 * the solver is name-based. A dangling id (mode deleted) falls back to "default".
 */
export function resolveModeName(
  ref: string,
  idToName: Map<string, string>,
  nameSet: Set<string>
): string {
  if (ref === 'default' || ref === 'all') return ref;
  if (idToName.has(ref)) return idToName.get(ref)!;
  if (nameSet.has(ref)) return ref; // legacy name-based reference
  return 'default'; // dangling id (mode deleted)
}

/** Returns the active mode name for a date, or null if outside all modes. */
export function activeModeOn(date: ISODate, modes: Mode[]): string | null {
  for (const m of modes) {
    if (date >= m.span[0] && date <= m.span[1]) return m.name;
  }
  return null;
}

/** Is the given intent active on the given date under the mode rules? */
export function isIntentActiveOn(
  intent: Intent,
  date: ISODate,
  modes: Mode[]
): boolean {
  if (intent.mode === 'all') return true;
  const active = activeModeOn(date, modes);
  if (active === null) return intent.mode === 'default';
  return intent.mode === active;
}

/** Detect overlapping mode spans (a conflict to flag). */
export function detectModeOverlaps(modes: Mode[]): ConflictReport[] {
  const conflicts: ConflictReport[] = [];
  const sorted = [...modes].sort((a, b) => a.span[0].localeCompare(b.span[0]));
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const a = sorted[i];
      const b = sorted[j];
      if (a.span[1] >= b.span[0] && b.span[1] >= a.span[0]) {
        conflicts.push({
          kind: 'mode-overlap',
          message: `Modes "${a.name}" and "${b.name}" overlap in time.`,
          involved: [a.name, b.name],
          date: b.span[0],
        });
      }
    }
  }
  return conflicts;
}
