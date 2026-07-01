/**
 * Backend-authoritative solving with temporal stability.
 *
 * The calendar is `frozen_past ⊕ solved_future`. Every read goes through
 * getSolved, which:
 *   1. Freezes the elapsed slice of the last published projection (immutable past).
 *   2. Reaps intents that can produce no further occurrences.
 *   3. Solves whole, period-aligned buckets (so cardinality spreads naturally)
 *      with the frozen past seeded as immovable obstacles.
 *   4. Overlays the frozen past over the projected past and caches the result.
 * This keeps every client — the web UI and the ICS feed — thin and identical, and
 * makes the past stable across edits and the passage of time.
 */
import { solve, renderICS, alignHorizonStart, overlay, realizedConflicts, isFullyPassed } from '../../src/index';
import { addDays, localNow, startOfISOWeek } from '../../src/time';
import type { Instance, ConflictReport, CalendarEvent } from '../../src/index';
import {
  getConfig,
  listIntents,
  listModes,
  getCache,
  setCache,
  recordMetric,
  listFrozen,
  freezeInstances,
  pruneFrozen,
  deleteIntent,
} from './repo';

const HORIZON_DAYS = 365; // rolling 12 months forward
const RETENTION_DAYS = 90; // rolling ~3 months of frozen history

export interface SolvedResult {
  instances: Instance[];
  conflicts: ConflictReport[];
  ics: string;
  horizon: { start: string; end: string };
  solveMs: number;
  instanceCount: number;
  computedAt: string;
  cached: boolean;
}

/** Resolve an intent's mode reference (id | "default" | "all" | legacy name) to
 *  the mode NAME the solver expects. */
function resolveModeName(ref: string, idToName: Map<string, string>, nameSet: Set<string>): string {
  if (ref === 'default' || ref === 'all') return ref;
  if (idToName.has(ref)) return idToName.get(ref)!;
  if (nameSet.has(ref)) return ref; // legacy name-based reference
  return 'default'; // dangling id (mode deleted)
}

/** A date (YYYY-MM-DD) at a fixed UTC offset for a given epoch-ms instant. */
function localDate(ms: number, utcOffsetMinutes: number): string {
  const shifted = new Date(ms + utcOffsetMinutes * 60_000);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const d = String(shifted.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Today's date (YYYY-MM-DD) in the user's fixed UTC offset. */
function localToday(utcOffsetMinutes: number): string {
  return localDate(Date.now(), utcOffsetMinutes);
}

export async function getSolved(db: D1Database, userId: string): Promise<SolvedResult> {
  const config = await getConfig(db, userId);
  const offset = config.utcOffsetMinutes ?? 0;
  const today = localToday(offset);
  const nowDT = localNow(offset);
  const retentionStart = addDays(today, -RETENTION_DAYS);

  // --- Freeze-on-read: snapshot the elapsed slice of the last published
  // projection (immutable past), then drop history beyond the retention window.
  const cache = await getCache(db, userId);
  if (cache) {
    const cachedInstances: Instance[] = JSON.parse(cache.instances_json);
    await freezeInstances(db, userId, cachedInstances.filter((i) => i.start < nowDT));
  }
  await pruneFrozen(db, userId, retentionStart);

  // Serve the cache when it's clean AND still for the current day (the horizon
  // rolls daily even without edits, keeping the feed fresh).
  if (cache && cache.stale === 0 && localDate(Date.parse(cache.computed_at), offset) === today) {
    return {
      instances: JSON.parse(cache.instances_json),
      conflicts: JSON.parse(cache.conflicts_json),
      ics: cache.ics,
      horizon: { start: cache.horizon_start, end: cache.horizon_end },
      solveMs: cache.solve_ms,
      instanceCount: cache.instance_count,
      computedAt: cache.computed_at,
      cached: true,
    };
  }

  const [intents, modeRecords] = await Promise.all([listIntents(db, userId), listModes(db, userId)]);
  const modes = modeRecords.map((m) => ({ name: m.name, span: m.span }));

  // Intents reference a mode by ID (or the reserved "default"/"all"); the solver
  // is name-based, so resolve IDs → current names here.
  const idToName = new Map(modeRecords.map((m) => [m.id, m.name] as const));
  const nameSet = new Set(modeRecords.map((m) => m.name));
  const resolvedIntents = intents.map((i) => ({ ...i, mode: resolveModeName(i.mode, idToName, nameSet) }));

  const end = addDays(today, HORIZON_DAYS);

  // --- Reap intents that can produce no further occurrences. Their already-
  // happened instances live on as frozen history, decoupled from the intent.
  const liveIntents = [];
  for (const intent of resolvedIntents) {
    if (isFullyPassed(intent, modes, today, end)) {
      if (intent.id) await deleteIntent(db, userId, intent.id);
      continue;
    }
    liveIntents.push(intent);
  }

  // --- Solve whole, period-aligned buckets so cardinality spreads across the
  // real period (not the truncated remainder). Seed only STILL-IN-PROGRESS frozen
  // events (end > now) as immovable obstacles: a future placement (start >= now)
  // can only ever collide with a frozen event that hasn't finished yet. Seeding
  // fully-elapsed events instead makes the solver's own re-projection of them
  // collide with their frozen twin — spilling flexible days onto other dates and
  // displacing real occurrences — for no benefit, since those projections are
  // dropped by the overlay anyway.
  const frozen = await listFrozen(db, userId, retentionStart);
  const existingCalendar: CalendarEvent[] = frozen
    .filter((f) => f.end > nowDT)
    .map((f) => ({ uid: f.uid, subject: f.subject, start: f.start, end: f.end }));
  const horizon = { start: alignHorizonStart(today), end };

  const perf = (globalThis as any).performance;
  const t0 = perf?.now?.() ?? Date.now();
  const out = solve({ config, intents: liveIntents, modes, existingCalendar, horizon });
  const t1 = perf?.now?.() ?? Date.now();
  const solveMs = Math.round(t1 - t0);

  // --- Overlay: immutable frozen past + projected future (past projections drop).
  const instances = overlay(frozen, out.instances, nowDT);
  // Drop conflicts that no longer correspond to a real overlap in the overlaid
  // output (e.g. a dropped past projection colliding with its own frozen twin).
  const conflicts = realizedConflicts(out.conflicts, instances, today);
  const ics = renderICS(instances, 'Calendizer', config.utcOffsetMinutes);
  const computedAt = new Date().toISOString();

  // Return a retention-window-aligned start so the web can page ~3 months back.
  const returnedStart = startOfISOWeek(retentionStart);

  await setCache(db, {
    user_id: userId,
    instances_json: JSON.stringify(instances),
    conflicts_json: JSON.stringify(conflicts),
    ics,
    horizon_start: returnedStart,
    horizon_end: end,
    solve_ms: solveMs,
    instance_count: instances.length,
    computed_at: computedAt,
    stale: 0,
  });
  await recordMetric(db, userId, solveMs, instances.length, liveIntents.length);

  return {
    instances,
    conflicts,
    ics,
    horizon: { start: returnedStart, end },
    solveMs,
    instanceCount: instances.length,
    computedAt,
    cached: false,
  };
}
