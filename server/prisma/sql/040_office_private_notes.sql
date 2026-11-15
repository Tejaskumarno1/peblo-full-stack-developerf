-- Private notes in an Office (mockups WsE01 to WsE03). A note written in an Office is private to its author until opened up.
-- office_everyone: NULL = only the author (and people named in note_access), 'view' or 'edit' = everyone in that Office.
ALTER TABLE notes ADD COLUMN IF NOT EXISTS office_everyone TEXT CHECK (office_everyone IN ('view', 'edit'));

CREATE TABLE IF NOT EXISTS note_access (
  note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  level TEXT NOT NULL CHECK (level IN ('view', 'edit')),
  granted_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (note_id, user_id)
);

CREATE INDEX IF NOT EXISTS note_access_user_idx ON note_access (user_id);

-- Notes that already exist in an Office keep working for everyone, exactly as before; only notes written from now on start private.
UPDATE notes SET office_everyone = 'edit' WHERE office_everyone IS NULL AND space_id IN (SELECT id FROM spaces WHERE kind = 'office');
