/**
 * Calendar storage + the stale-feed fallback.
 *
 * Solving moved to the client: the browser runs the shared `assembleSchedule`
 * pipeline and publishes the result. This module now (1) reads the stored
 * published calendar, (2) stores a client-supplied calendar while enforcing the
 * frozen past server-side (freeze the elapsed slice immutably, then overlay the
 * authoritative frozen past so a stale/buggy client can't rewrite history), and
 * (3) runs a full server-side solve only as the stale-feed fallback.
 */
import { renderICS, overlay, realizedConflicts, assembleSchedule } from '../../src/index';
import { addDays, localNow } from '../../src/time';
import type { Instance, ConflictReport, GlobalConfig } from '../../src/index';
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

/** A calendar as the client publishes it (before the server's frozen-past overlay). */
export interface CalendarPayload {
  instances: Instance[];
  conflicts: ConflictReport[];
  horizon: { start: string; end: string };
  computedAt?: string;
  solveMs?: number;
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

/** Read the stored published calendar (no solve). Null if nothing published yet. */
export async function getStoredCalendar(db: D1Database, userId: string): Promise<SolvedResult | null> {
  const cache = await getCache(db, userId);
  if (!cache) return null;
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

/** Age of the stored calendar in days, or Infinity if none. */
export async function storedCalendarAgeDays(db: D1Database, userId: string, offset: number): Promise<number> {
  const cache = await getCache(db, userId);
  if (!cache) return Infinity;
  const computed = localDate(Date.parse(cache.computed_at), offset);
  return Math.max(0, (Date.parse(localToday(offset)) - Date.parse(computed)) / 86_400_000);
}

/**
 * Store a client-supplied (or fallback-computed) calendar, enforcing the frozen
 * past server-side: freeze the elapsed slice (immutable), prune retention, then
 * overlay the authoritative frozen past so a stale/buggy client can't rewrite
 * history. Renders + caches the ICS.
 */
export async function storeCalendar(
  db: D1Database,
  userId: string,
  config: GlobalConfig,
  cal: CalendarPayload
): Promise<SolvedResult> {
  const offset = config.utcOffsetMinutes ?? 0;
  const nowDT = localNow(offset);
  const today = localToday(offset);
  const retentionStart = addDays(today, -RETENTION_DAYS);

  await freezeInstances(db, userId, cal.instances.filter((i) => i.start < nowDT));
  await pruneFrozen(db, userId, retentionStart);
  const frozen = await listFrozen(db, userId, retentionStart);
  const instances = overlay(frozen, cal.instances, nowDT);
  const conflicts = realizedConflicts(cal.conflicts, instances, today);
  const ics = renderICS(instances, 'Calendizer', config.utcOffsetMinutes, config.subtasksAsEvents);
  const computedAt = cal.computedAt ?? new Date().toISOString();
  const solveMs = cal.solveMs ?? 0;

  await setCache(db, {
    user_id: userId,
    instances_json: JSON.stringify(instances),
    conflicts_json: JSON.stringify(conflicts),
    ics,
    horizon_start: cal.horizon.start,
    horizon_end: cal.horizon.end,
    solve_ms: solveMs,
    instance_count: instances.length,
    computed_at: computedAt,
    stale: 0,
  });
  await recordMetric(db, userId, solveMs, instances.length, 0);

  return {
    instances,
    conflicts,
    ics,
    horizon: cal.horizon,
    solveMs,
    instanceCount: instances.length,
    computedAt,
    cached: false,
  };
}

/**
 * Full server-side (re)solve — the stale-feed fallback. Loads inputs, runs the
 * shared pipeline, applies reaps, and stores via storeCalendar.
 */
export async function resolveCalendar(db: D1Database, userId: string): Promise<SolvedResult> {
  const config = await getConfig(db, userId);
  const offset = config.utcOffsetMinutes ?? 0;
  const nowDT = localNow(offset);
  const today = localToday(offset);
  const retentionStart = addDays(today, -RETENTION_DAYS);

  const [intents, modeRecords, frozen] = await Promise.all([
    listIntents(db, userId),
    listModes(db, userId),
    listFrozen(db, userId, retentionStart),
  ]);

  const r = assembleSchedule({
    config,
    intents,
    modeRecords: modeRecords.map((m) => ({ id: m.id, name: m.name, span: m.span })),
    frozen,
    nowDT,
    today,
  });
  for (const id of r.reapedIntentIds) await deleteIntent(db, userId, id);

  return storeCalendar(db, userId, config, {
    instances: r.instances,
    conflicts: r.conflicts,
    horizon: r.horizon,
    solveMs: r.solveMs,
  });
}
