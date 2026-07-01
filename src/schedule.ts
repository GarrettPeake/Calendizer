/**
 * Pure schedule assembly — the temporal pipeline with no I/O.
 *
 * This is the orchestration that used to live in the API's `getSolved`, extracted
 * so it runs identically in the browser (the normal path) and in the Worker (the
 * stale-feed fallback). It takes the current inputs plus the retained frozen past
 * and returns the full calendar (frozen past ⊕ solved future), the realized
 * conflicts, the ids of intents that can be reaped, and the paging horizon.
 *
 * `now`/`today` are parameters (never `Date.now()`) so the function stays pure and
 * deterministic. DB reads/writes, mode persistence and ICS rendering are the
 * caller's job.
 */
import { GlobalConfig, Intent, Mode, Instance, CalendarEvent, ConflictReport } from './types';
import { ISODate, ISODateTime, addDays, startOfISOWeek } from './time';
import { alignHorizonStart, overlay, realizedConflicts, isFullyPassed } from './temporal';
import { resolveModeName } from './modes';
import { Solver, greedySolver } from './solver';

/** A stored mode as the app persists it (id + name + span). */
export interface ModeRecord {
  id?: string;
  name: string;
  span: [ISODate, ISODate];
}

export interface AssembleInput {
  config: GlobalConfig;
  /** Raw intents; `mode` may be an id, "default"/"all", or a legacy name. */
  intents: Intent[];
  modeRecords: ModeRecord[];
  /** The retained frozen past (previously published occurrences). */
  frozen: Instance[];
  /** Current wall-clock instant, "YYYY-MM-DDTHH:MM", in the user's offset. */
  nowDT: ISODateTime;
  /** Today's date "YYYY-MM-DD" in the user's offset. */
  today: ISODate;
  /** Days of future horizon (default 365). */
  horizonDays?: number;
  /** Days of frozen history to retain (default 90). */
  retentionDays?: number;
  /** Placement engine (default: the deterministic greedy solver). */
  solver?: Solver;
}

export interface AssembleResult {
  instances: Instance[];
  conflicts: ConflictReport[];
  /** Intents that can produce no further occurrences and may be deleted. */
  reapedIntentIds: string[];
  /** Retention-aligned start (for paging back) → future end. */
  horizon: { start: ISODate; end: ISODate };
  solveMs: number;
}

export function assembleSchedule(input: AssembleInput): AssembleResult {
  const { config, intents, modeRecords, nowDT, today } = input;
  const solver = input.solver ?? greedySolver;
  const horizonDays = input.horizonDays ?? 365;
  const retentionDays = input.retentionDays ?? 90;

  const end = addDays(today, horizonDays);
  const retentionStart = addDays(today, -retentionDays);

  // The frozen set is the immutable PAST only: `overlay` keeps all of it verbatim,
  // so any future occurrence left in here would wrongly persist instead of being
  // re-solved. Enforce start < now (and retention) defensively — the client may
  // hand us its whole previous calendar.
  const frozen = input.frozen.filter((f) => f.date >= retentionStart && f.start < nowDT);

  const modes: Mode[] = modeRecords.map((m) => ({ name: m.name, span: m.span }));
  const idToName = new Map(modeRecords.filter((m) => m.id).map((m) => [m.id as string, m.name] as const));
  const nameSet = new Set(modeRecords.map((m) => m.name));
  const resolvedIntents = intents.map((i) => ({ ...i, mode: resolveModeName(i.mode, idToName, nameSet) }));

  // Reap intents with no future candidate occurrences; their already-happened
  // instances live on in the frozen past, decoupled from the intent.
  const reapedIntentIds: string[] = [];
  const liveIntents: Intent[] = [];
  for (const intent of resolvedIntents) {
    if (isFullyPassed(intent, modes, today, end)) {
      if (intent.id) reapedIntentIds.push(intent.id);
      continue;
    }
    liveIntents.push(intent);
  }

  // Seed only still-in-progress frozen events (end > now) as immovable obstacles;
  // a future placement can only ever collide with one that hasn't finished yet.
  const existingCalendar: CalendarEvent[] = frozen
    .filter((f) => f.end > nowDT)
    .map((f) => ({ uid: f.uid, subject: f.subject, start: f.start, end: f.end }));
  const horizon = { start: alignHorizonStart(today), end };

  const perf = (globalThis as { performance?: { now?: () => number } }).performance;
  const t0 = perf?.now?.() ?? Date.now();
  const out = solver.solve({ config, intents: liveIntents, modes, existingCalendar, horizon });
  const solveMs = Math.round((perf?.now?.() ?? Date.now()) - t0);

  // Overlay: immutable frozen past over projected past (past projections drop),
  // then keep only conflicts that survive as a real overlap in the output.
  const instances = overlay(frozen, out.instances, nowDT);
  const conflicts = realizedConflicts(out.conflicts, instances, today);

  return {
    instances,
    conflicts,
    reapedIntentIds,
    horizon: { start: startOfISOWeek(retentionStart), end },
    solveMs,
  };
}
