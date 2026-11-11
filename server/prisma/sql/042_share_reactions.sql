-- Reactions on a shared page (S28): one of a few icons per person per page; tapping again takes it back.
CREATE TABLE IF NOT EXISTS share_reactions (
  note_id    TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE ON UPDATE CASCADE,
  session_id TEXT NOT NULL,
  kind       TEXT NOT NULL,
  at         TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  PRIMARY KEY (note_id, session_id, kind)
);
ALTER TABLE share_reactions ENABLE ROW LEVEL SECURITY;
