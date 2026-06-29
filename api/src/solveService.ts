/**
 * Backend-authoritative solving. Every read goes through getSolved, which serves
 * a cached 12-month solve and recomputes it (recording timing metrics) whenever a
 * user input has changed. This keeps every client — the web UI and the ICS feed —
 * thin and identical.
 */
import { solve, renderICS } from '../../src/index';
import { addDays } from '../../src/time';
import type { Instance, ConflictReport } from '../../src/index';
import {
  getConfig,
  listIntents,
  listModes,
  getCache,
  setCache,
  recordMetric,
} from './repo';

const HORIZON_DAYS = 365; // rolling 12 months

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

/** Today's date (YYYY-MM-DD) in the user's fixed UTC offset. */
function localToday(utcOffsetMinutes: number): string {
  const shifted = new Date(Date.now() + utcOffsetMinutes * 60_000);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const d = String(shifted.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export async function getSolved(db: D1Database, userId: string): Promise<SolvedResult> {
  const cache = await getCache(db, userId);
  if (cache && cache.stale === 0) {
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

  const [config, intents, modeRecords] = await Promise.all([
    getConfig(db, userId),
    listIntents(db, userId),
    listModes(db, userId),
  ]);
  const modes = modeRecords.map((m) => ({ name: m.name, span: m.span }));

  const start = localToday(config.utcOffsetMinutes ?? 0);
  const end = addDays(start, HORIZON_DAYS);

  const perf = (globalThis as any).performance;
  const t0 = perf?.now?.() ?? Date.now();
  const out = solve({ config, intents, modes, horizon: { start, end } });
  const t1 = perf?.now?.() ?? Date.now();
  const solveMs = Math.round(t1 - t0);

  const ics = renderICS(out.instances);
  const computedAt = new Date().toISOString();

  await setCache(db, {
    user_id: userId,
    instances_json: JSON.stringify(out.instances),
    conflicts_json: JSON.stringify(out.conflicts),
    ics,
    horizon_start: start,
    horizon_end: end,
    solve_ms: solveMs,
    instance_count: out.instances.length,
    computed_at: computedAt,
    stale: 0,
  });
  await recordMetric(db, userId, solveMs, out.instances.length, intents.length);

  return {
    instances: out.instances,
    conflicts: out.conflicts,
    ics,
    horizon: { start, end },
    solveMs,
    instanceCount: out.instances.length,
    computedAt,
    cached: false,
  };
}
