-- @mentions in notes: one row per (note, mentioned person) with the time of the last notification, so a person is told at most once per note per 24 hours.
CREATE TABLE IF NOT EXISTS note_mentions (
  note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  notified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (note_id, user_id)
)
