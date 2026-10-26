-- Polls written into a shared page, read receipts for link analytics, a short link, the owner's style, and "please extend".
CREATE TABLE IF NOT EXISTS share_polls (
  id        TEXT PRIMARY KEY,
  note_id   TEXT NOT NULL,
  question  TEXT NOT NULL,
  options   JSONB NOT NULL,
  open      BOOLEAN NOT NULL DEFAULT TRUE,
  named     BOOLEAN NOT NULL DEFAULT FALSE,
  at        TIMESTAMP(3) NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS share_polls_note_idx ON share_polls (note_id, at);
CREATE TABLE IF NOT EXISTS share_poll_votes (
  poll_id    TEXT NOT NULL,
  session_id TEXT NOT NULL,
  name       TEXT NOT NULL DEFAULT 'Guest',
  choice     INTEGER NOT NULL,
  at         TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  PRIMARY KEY (poll_id, session_id)
);
CREATE TABLE IF NOT EXISTS share_reads (
  kind        TEXT NOT NULL,
  share_token TEXT NOT NULL,
  session_id  TEXT NOT NULL,
  name        TEXT NOT NULL DEFAULT 'Guest',
  progress    INTEGER NOT NULL DEFAULT 0,
  secs        INTEGER NOT NULL DEFAULT 0,
  opened_at   TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  last_at     TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  PRIMARY KEY (kind, share_token, session_id)
);
ALTER TABLE share_settings ADD COLUMN IF NOT EXISTS short_code TEXT;
ALTER TABLE share_settings ADD COLUMN IF NOT EXISTS style TEXT;
ALTER TABLE share_settings ADD COLUMN IF NOT EXISTS extend_at TIMESTAMP(3);
ALTER TABLE share_settings ADD COLUMN IF NOT EXISTS extend_by TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS share_settings_short_idx ON share_settings (short_code) WHERE short_code IS NOT NULL;
