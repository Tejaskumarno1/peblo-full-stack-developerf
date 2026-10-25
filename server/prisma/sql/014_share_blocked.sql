-- People the owner removed from a shared link. Matched by the viewer's session id, so a removed guest stays out
-- of that link (they would need a new link). Rows are cleaned up after a week.
CREATE TABLE IF NOT EXISTS share_blocked (
  kind        TEXT NOT NULL,
  share_token TEXT NOT NULL,
  session_id  TEXT NOT NULL,
  at          TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  PRIMARY KEY (kind, share_token, session_id)
);
CREATE INDEX IF NOT EXISTS share_blocked_at_idx ON share_blocked (at);
