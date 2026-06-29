-- Calendizer initial schema.

CREATE TABLE IF NOT EXISTS users (
  id              TEXT PRIMARY KEY,
  username        TEXT UNIQUE NOT NULL,
  password_hash   TEXT NOT NULL,
  password_salt   TEXT NOT NULL,
  feed_secret     TEXT UNIQUE NOT NULL,
  feed_rotated_at TEXT,
  created_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_config (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  json    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS intents (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  json       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_intents_user ON intents(user_id);

CREATE TABLE IF NOT EXISTS modes (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  name       TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_modes_user ON modes(user_id);

CREATE TABLE IF NOT EXISTS solve_cache (
  user_id        TEXT PRIMARY KEY REFERENCES users(id),
  instances_json TEXT NOT NULL,
  conflicts_json TEXT NOT NULL,
  ics            TEXT NOT NULL,
  horizon_start  TEXT NOT NULL,
  horizon_end    TEXT NOT NULL,
  solve_ms       INTEGER NOT NULL,
  instance_count INTEGER NOT NULL,
  computed_at    TEXT NOT NULL,
  stale          INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS solve_metrics (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        TEXT NOT NULL,
  solve_ms       INTEGER NOT NULL,
  instance_count INTEGER NOT NULL,
  intent_count   INTEGER NOT NULL,
  computed_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_metrics_user ON solve_metrics(user_id, id);
