-- Which block of the note each person on a share link is in (shown as a coloured marker), and a short log of what happened on a link.
ALTER TABLE share_viewers ADD COLUMN IF NOT EXISTS cursor_block INTEGER;

CREATE TABLE IF NOT EXISTS share_activity (
  id BIGSERIAL PRIMARY KEY,
  note_id TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('viewed', 'edited', 'merged', 'clash')),
  at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS share_activity_note_at_idx ON share_activity (note_id, at DESC);
