-- User-submitted bug reports. Captures a snapshot for triage: the user's local
-- datetime, their full config, and the schedule for the week they were viewing.

CREATE TABLE IF NOT EXISTS bug_reports (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id),
  username        TEXT NOT NULL,
  description     TEXT NOT NULL,
  client_datetime TEXT,             -- the user's local "now" (ISO instant)
  timezone        TEXT,             -- IANA tz reported by the browser
  config_json     TEXT NOT NULL,    -- full GlobalConfig at report time
  week_start      TEXT,             -- Monday of the viewed week
  week_end        TEXT,             -- Sunday of the viewed week
  schedule_json   TEXT NOT NULL,    -- Instance[] for the viewed week
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bug_reports_created ON bug_reports(created_at);
