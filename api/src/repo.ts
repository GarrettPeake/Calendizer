/**
 * D1 data access + mappers between rows and the shared library types.
 */
import type { GlobalConfig, Intent, Mode } from '../../src/index';

export interface UserRow {
  id: string;
  username: string;
  password_hash: string;
  password_salt: string;
  feed_secret: string;
  feed_rotated_at: string | null;
  created_at: string;
}

export interface ModeRecord extends Mode {
  id: string;
}

export function defaultConfig(): GlobalConfig {
  return {
    wakeup: '07:00',
    sleep: '23:00',
    padding: 0,
    grid: 5,
    min_break: 15,
    max_block: 180,
    utcOffsetMinutes: 0,
    fillToMax: true,
  };
}

const now = () => new Date().toISOString();

/* ----------------------------- users ----------------------------- */

export async function createUser(
  db: D1Database,
  username: string,
  passwordHash: string,
  passwordSalt: string
): Promise<UserRow> {
  const id = crypto.randomUUID();
  const feedSecret = crypto.randomUUID();
  const createdAt = now();
  await db
    .prepare(
      `INSERT INTO users (id, username, password_hash, password_salt, feed_secret, feed_rotated_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(id, username, passwordHash, passwordSalt, feedSecret, createdAt, createdAt)
    .run();
  await db
    .prepare(`INSERT INTO user_config (user_id, json) VALUES (?, ?)`)
    .bind(id, JSON.stringify(defaultConfig()))
    .run();
  return {
    id,
    username,
    password_hash: passwordHash,
    password_salt: passwordSalt,
    feed_secret: feedSecret,
    feed_rotated_at: createdAt,
    created_at: createdAt,
  };
}

export function getUserByUsername(db: D1Database, username: string): Promise<UserRow | null> {
  return db.prepare(`SELECT * FROM users WHERE username = ?`).bind(username).first<UserRow>();
}
export function getUserById(db: D1Database, id: string): Promise<UserRow | null> {
  return db.prepare(`SELECT * FROM users WHERE id = ?`).bind(id).first<UserRow>();
}
export function getUserByFeedSecret(db: D1Database, secret: string): Promise<UserRow | null> {
  return db.prepare(`SELECT * FROM users WHERE feed_secret = ?`).bind(secret).first<UserRow>();
}

export async function rotateFeedSecret(db: D1Database, userId: string): Promise<string> {
  const secret = crypto.randomUUID();
  await db
    .prepare(`UPDATE users SET feed_secret = ?, feed_rotated_at = ? WHERE id = ?`)
    .bind(secret, now(), userId)
    .run();
  return secret;
}

/* ----------------------------- config ----------------------------- */

export async function getConfig(db: D1Database, userId: string): Promise<GlobalConfig> {
  const row = await db.prepare(`SELECT json FROM user_config WHERE user_id = ?`).bind(userId).first<{ json: string }>();
  return row ? (JSON.parse(row.json) as GlobalConfig) : defaultConfig();
}
export async function setConfig(db: D1Database, userId: string, config: GlobalConfig): Promise<void> {
  await db
    .prepare(`INSERT INTO user_config (user_id, json) VALUES (?, ?)
              ON CONFLICT(user_id) DO UPDATE SET json = excluded.json`)
    .bind(userId, JSON.stringify(config))
    .run();
}

/* ----------------------------- intents ----------------------------- */

export async function listIntents(db: D1Database, userId: string): Promise<Intent[]> {
  const res = await db.prepare(`SELECT json FROM intents WHERE user_id = ? ORDER BY created_at`).bind(userId).all<{ json: string }>();
  return (res.results ?? []).map((r) => JSON.parse(r.json) as Intent);
}
export async function getIntent(db: D1Database, userId: string, id: string): Promise<Intent | null> {
  const row = await db.prepare(`SELECT json FROM intents WHERE user_id = ? AND id = ?`).bind(userId, id).first<{ json: string }>();
  return row ? (JSON.parse(row.json) as Intent) : null;
}
export async function createIntent(db: D1Database, userId: string, intent: Intent): Promise<Intent> {
  const id = intent.id ?? crypto.randomUUID();
  const stored: Intent = { ...intent, id };
  const ts = now();
  await db
    .prepare(`INSERT INTO intents (id, user_id, json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`)
    .bind(id, userId, JSON.stringify(stored), ts, ts)
    .run();
  return stored;
}
export async function updateIntent(db: D1Database, userId: string, id: string, intent: Intent): Promise<Intent | null> {
  const existing = await getIntent(db, userId, id);
  if (!existing) return null;
  const stored: Intent = { ...intent, id };
  await db
    .prepare(`UPDATE intents SET json = ?, updated_at = ? WHERE user_id = ? AND id = ?`)
    .bind(JSON.stringify(stored), now(), userId, id)
    .run();
  return stored;
}
export async function deleteIntent(db: D1Database, userId: string, id: string): Promise<boolean> {
  const res = await db.prepare(`DELETE FROM intents WHERE user_id = ? AND id = ?`).bind(userId, id).run();
  return (res.meta.changes ?? 0) > 0;
}

/* ----------------------------- modes ----------------------------- */

function rowToMode(r: { id: string; name: string; start_date: string; end_date: string }): ModeRecord {
  return { id: r.id, name: r.name, span: [r.start_date, r.end_date] };
}

export async function listModes(db: D1Database, userId: string): Promise<ModeRecord[]> {
  const res = await db
    .prepare(`SELECT id, name, start_date, end_date FROM modes WHERE user_id = ? ORDER BY start_date`)
    .bind(userId)
    .all<{ id: string; name: string; start_date: string; end_date: string }>();
  return (res.results ?? []).map(rowToMode);
}
export async function createMode(db: D1Database, userId: string, mode: Mode): Promise<ModeRecord> {
  const id = crypto.randomUUID();
  await db
    .prepare(`INSERT INTO modes (id, user_id, name, start_date, end_date) VALUES (?, ?, ?, ?, ?)`)
    .bind(id, userId, mode.name, mode.span[0], mode.span[1])
    .run();
  return { id, name: mode.name, span: mode.span };
}
export async function updateMode(db: D1Database, userId: string, id: string, mode: Mode): Promise<ModeRecord | null> {
  const res = await db
    .prepare(`UPDATE modes SET name = ?, start_date = ?, end_date = ? WHERE user_id = ? AND id = ?`)
    .bind(mode.name, mode.span[0], mode.span[1], userId, id)
    .run();
  if ((res.meta.changes ?? 0) === 0) return null;
  return { id, name: mode.name, span: mode.span };
}
export async function deleteMode(db: D1Database, userId: string, id: string): Promise<boolean> {
  const res = await db.prepare(`DELETE FROM modes WHERE user_id = ? AND id = ?`).bind(userId, id).run();
  return (res.meta.changes ?? 0) > 0;
}

/* ----------------------------- solve cache + metrics ----------------------------- */

export interface SolveCacheRow {
  user_id: string;
  instances_json: string;
  conflicts_json: string;
  ics: string;
  horizon_start: string;
  horizon_end: string;
  solve_ms: number;
  instance_count: number;
  computed_at: string;
  stale: number;
}

export function getCache(db: D1Database, userId: string): Promise<SolveCacheRow | null> {
  return db.prepare(`SELECT * FROM solve_cache WHERE user_id = ?`).bind(userId).first<SolveCacheRow>();
}

export async function setCache(db: D1Database, row: SolveCacheRow): Promise<void> {
  await db
    .prepare(
      `INSERT INTO solve_cache
         (user_id, instances_json, conflicts_json, ics, horizon_start, horizon_end, solve_ms, instance_count, computed_at, stale)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
       ON CONFLICT(user_id) DO UPDATE SET
         instances_json = excluded.instances_json,
         conflicts_json = excluded.conflicts_json,
         ics = excluded.ics,
         horizon_start = excluded.horizon_start,
         horizon_end = excluded.horizon_end,
         solve_ms = excluded.solve_ms,
         instance_count = excluded.instance_count,
         computed_at = excluded.computed_at,
         stale = 0`
    )
    .bind(
      row.user_id,
      row.instances_json,
      row.conflicts_json,
      row.ics,
      row.horizon_start,
      row.horizon_end,
      row.solve_ms,
      row.instance_count,
      row.computed_at
    )
    .run();
}

/** Mark the cached solve dirty — called after any input change. */
export async function invalidateCache(db: D1Database, userId: string): Promise<void> {
  await db.prepare(`UPDATE solve_cache SET stale = 1 WHERE user_id = ?`).bind(userId).run();
}

export async function recordMetric(
  db: D1Database,
  userId: string,
  solveMs: number,
  instanceCount: number,
  intentCount: number
): Promise<void> {
  await db
    .prepare(`INSERT INTO solve_metrics (user_id, solve_ms, instance_count, intent_count, computed_at) VALUES (?, ?, ?, ?, ?)`)
    .bind(userId, solveMs, instanceCount, intentCount, now())
    .run();
}

export interface MetricRow {
  solve_ms: number;
  instance_count: number;
  intent_count: number;
  computed_at: string;
}
export async function listMetrics(db: D1Database, userId: string, limit = 50): Promise<MetricRow[]> {
  const res = await db
    .prepare(`SELECT solve_ms, instance_count, intent_count, computed_at FROM solve_metrics WHERE user_id = ? ORDER BY id DESC LIMIT ?`)
    .bind(userId, limit)
    .all<MetricRow>();
  return res.results ?? [];
}

/* ----------------------------- bug reports ----------------------------- */

export interface BugReportInput {
  description: string;
  clientDatetime?: string;
  timezone?: string;
  config: unknown;
  weekStart?: string;
  weekEnd?: string;
  schedule: unknown;
}

export async function createBugReport(
  db: D1Database,
  userId: string,
  username: string,
  r: BugReportInput
): Promise<{ id: string; createdAt: string }> {
  const id = crypto.randomUUID();
  const createdAt = now();
  await db
    .prepare(
      `INSERT INTO bug_reports
         (id, user_id, username, description, client_datetime, timezone, config_json, week_start, week_end, schedule_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      userId,
      username,
      r.description,
      r.clientDatetime ?? null,
      r.timezone ?? null,
      JSON.stringify(r.config ?? null),
      r.weekStart ?? null,
      r.weekEnd ?? null,
      JSON.stringify(r.schedule ?? null),
      createdAt
    )
    .run();
  return { id, createdAt };
}
