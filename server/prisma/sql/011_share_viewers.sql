CREATE TABLE IF NOT EXISTS share_viewers (
  kind TEXT NOT NULL CHECK (kind IN ('note', 'todo')),
  share_token TEXT NOT NULL,
  session_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  seen_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (kind, share_token, session_id)
);

CREATE INDEX IF NOT EXISTS share_viewers_seen_at_idx ON share_viewers (seen_at);
