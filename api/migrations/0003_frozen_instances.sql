-- Frozen (immutable) past occurrences. Once an occurrence has elapsed it is
-- snapshotted here from the last published projection and thereafter always
-- emitted verbatim, independent of the live intent (which may be edited or
-- deleted). PRIMARY KEY (user_id, uid) + INSERT OR IGNORE gives immutability:
-- a uid, once frozen, is never overwritten.
CREATE TABLE IF NOT EXISTS frozen_instances (
  user_id       TEXT NOT NULL REFERENCES users(id),
  uid           TEXT NOT NULL,
  intent_id     TEXT NOT NULL,
  subject       TEXT NOT NULL,
  date          TEXT NOT NULL,
  start         TEXT NOT NULL,   -- ISODateTime, local wall-clock
  end           TEXT NOT NULL,   -- ISODateTime, local wall-clock
  duration_min  INTEGER NOT NULL,
  children_json TEXT,
  placed_during_sleep INTEGER NOT NULL DEFAULT 0,
  frozen_at     TEXT NOT NULL,
  PRIMARY KEY (user_id, uid)
);
CREATE INDEX IF NOT EXISTS idx_frozen_user_date ON frozen_instances(user_id, date);
