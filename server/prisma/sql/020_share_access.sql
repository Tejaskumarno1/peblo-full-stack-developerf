-- Who may open a share link, and what each person may do on it.
-- share_settings: the owner can ask to let people in one by one ("waiting room").
-- share_guests: one row per guest session when the link asks for approval, or when the owner gave that person
-- their own role (view or edit) instead of the link's default.
CREATE TABLE IF NOT EXISTS share_settings (
  kind        TEXT NOT NULL,
  share_token TEXT NOT NULL,
  approval    BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (kind, share_token)
);
CREATE TABLE IF NOT EXISTS share_guests (
  kind        TEXT NOT NULL,
  share_token TEXT NOT NULL,
  session_id  TEXT NOT NULL,
  name        TEXT NOT NULL DEFAULT 'Guest',
  status      TEXT NOT NULL DEFAULT 'waiting',
  role        TEXT,
  at          TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  PRIMARY KEY (kind, share_token, session_id)
);
CREATE INDEX IF NOT EXISTS share_guests_token_idx ON share_guests (kind, share_token, status);
