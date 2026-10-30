-- Database review fixes (additive; every statement can be re-run).
-- 1) Row level security was only switched on for the first tables (001, 002). Every table made later was reachable through
--    Supabase's public REST API with the anon key (media and files hold whole pictures and documents). The server connects as the
--    table owner, which is not affected by RLS, so turning it on changes nothing for the app and closes the public door.
ALTER TABLE oauth_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE oauth_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE mcp_activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE media ENABLE ROW LEVEL SECURITY;
ALTER TABLE files ENABLE ROW LEVEL SECURITY;
ALTER TABLE note_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE note_ydocs ENABLE ROW LEVEL SECURITY;
ALTER TABLE note_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE share_viewers ENABLE ROW LEVEL SECURITY;
ALTER TABLE share_activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE share_blocked ENABLE ROW LEVEL SECURITY;
ALTER TABLE share_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE share_guests ENABLE ROW LEVEL SECURITY;
ALTER TABLE share_polls ENABLE ROW LEVEL SECURITY;
ALTER TABLE share_poll_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE share_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE _peblo_migrations ENABLE ROW LEVEL SECURITY;

-- 2) Rows that outlived their owner: deleting an account or a note left notifications, poll data and activity behind.
--    Remove the existing orphans, then tie the tables to users/notes so the cascade covers them from now on.
DELETE FROM user_notifications WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = user_notifications.user_id);
ALTER TABLE user_notifications DROP CONSTRAINT IF EXISTS user_notifications_user_id_fkey;
ALTER TABLE user_notifications ADD CONSTRAINT user_notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE;

DELETE FROM share_activity WHERE NOT EXISTS (SELECT 1 FROM notes n WHERE n.id = share_activity.note_id);
ALTER TABLE share_activity DROP CONSTRAINT IF EXISTS share_activity_note_id_fkey;
ALTER TABLE share_activity ADD CONSTRAINT share_activity_note_id_fkey FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE ON UPDATE CASCADE;

DELETE FROM share_polls WHERE NOT EXISTS (SELECT 1 FROM notes n WHERE n.id = share_polls.note_id);
ALTER TABLE share_polls DROP CONSTRAINT IF EXISTS share_polls_note_id_fkey;
ALTER TABLE share_polls ADD CONSTRAINT share_polls_note_id_fkey FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE ON UPDATE CASCADE;

DELETE FROM share_poll_votes WHERE NOT EXISTS (SELECT 1 FROM share_polls p WHERE p.id = share_poll_votes.poll_id);
ALTER TABLE share_poll_votes DROP CONSTRAINT IF EXISTS share_poll_votes_poll_id_fkey;
ALTER TABLE share_poll_votes ADD CONSTRAINT share_poll_votes_poll_id_fkey FOREIGN KEY (poll_id) REFERENCES share_polls(id) ON DELETE CASCADE ON UPDATE CASCADE;

-- A deleted commenter keeps their comment (it still shows author_name) but no longer points at a user id.
UPDATE note_comments SET author_user_id = NULL WHERE author_user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = note_comments.author_user_id);
ALTER TABLE note_comments DROP CONSTRAINT IF EXISTS note_comments_author_user_id_fkey;
ALTER TABLE note_comments ADD CONSTRAINT note_comments_author_user_id_fkey FOREIGN KEY (author_user_id) REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE;

-- 3) Share tables keyed by a link token (no foreign key is possible: the token lives on notes or todos). Drop the rows of
--    links that no longer exist (note or task deleted, or the link turned off).
DELETE FROM share_settings s WHERE NOT EXISTS (SELECT 1 FROM notes n WHERE s.kind = 'note' AND n.share_token = s.share_token) AND NOT EXISTS (SELECT 1 FROM todos t WHERE s.kind = 'todo' AND t.share_token = s.share_token);
DELETE FROM share_guests s WHERE NOT EXISTS (SELECT 1 FROM notes n WHERE s.kind = 'note' AND n.share_token = s.share_token) AND NOT EXISTS (SELECT 1 FROM todos t WHERE s.kind = 'todo' AND t.share_token = s.share_token);
DELETE FROM share_reads s WHERE NOT EXISTS (SELECT 1 FROM notes n WHERE s.kind = 'note' AND n.share_token = s.share_token) AND NOT EXISTS (SELECT 1 FROM todos t WHERE s.kind = 'todo' AND t.share_token = s.share_token);
DELETE FROM share_blocked s WHERE NOT EXISTS (SELECT 1 FROM notes n WHERE s.kind = 'note' AND n.share_token = s.share_token) AND NOT EXISTS (SELECT 1 FROM todos t WHERE s.kind = 'todo' AND t.share_token = s.share_token);

-- 4) Retention: nothing ever removed used-up or expired email links, or expired sign-in codes.
DELETE FROM email_tokens WHERE expires_at < CURRENT_TIMESTAMP - INTERVAL '7 days';
DELETE FROM oauth_codes WHERE expires_at < now();
CREATE INDEX IF NOT EXISTS email_tokens_expires_idx ON email_tokens (expires_at);

-- 5) Indexes for lists that are read newest first per person.
CREATE INDEX IF NOT EXISTS ai_generations_user_created_idx ON ai_generations (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS quiz_runs_user_created_idx ON quiz_runs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS share_reads_last_at_idx ON share_reads (last_at);
