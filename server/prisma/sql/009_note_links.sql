-- Which note links to which, kept up to date when a note is saved, so "Linked from" is one quick lookup
-- instead of reading the text of every note.
CREATE TABLE note_links (
  source_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  target_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  PRIMARY KEY (source_id, target_id)
);
CREATE INDEX note_links_target_idx ON note_links (target_id);

-- Fill it from the notes that already exist.
INSERT INTO note_links (source_id, target_id)
SELECT DISTINCT s.id, t.id
FROM (SELECT n.id, n.user_id, (regexp_matches(n.content, '\]\(/notes/([A-Za-z0-9-]+)\)', 'g'))[1] AS target FROM notes n) s
JOIN notes t ON t.id = s.target AND t.user_id = s.user_id AND t.id <> s.id
ON CONFLICT DO NOTHING;
