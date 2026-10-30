-- Follow-up to 026 (additive; every statement can be re-run).
-- 1) 026 made note_comments.author_user_id a foreign key (ON DELETE SET NULL) but gave it no index, so deleting an account scanned every comment.
CREATE INDEX IF NOT EXISTS note_comments_author_user_idx ON note_comments (author_user_id) WHERE author_user_id IS NOT NULL;
-- 2) share_viewers is keyed by link token like the other share tables, but 026 only cleaned the others. Drop rows of links that no longer exist.
DELETE FROM share_viewers s WHERE NOT EXISTS (SELECT 1 FROM notes n WHERE s.kind = 'note' AND n.share_token = s.share_token) AND NOT EXISTS (SELECT 1 FROM todos t WHERE s.kind = 'todo' AND t.share_token = s.share_token);
