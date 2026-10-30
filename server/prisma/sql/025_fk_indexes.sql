-- Indexes for foreign keys that had none: deleting a user, client or note had to scan these tables, and the lookups below are filtered by them.
CREATE INDEX IF NOT EXISTS oauth_codes_client_id_idx ON oauth_codes (client_id);
CREATE INDEX IF NOT EXISTS oauth_codes_user_id_idx ON oauth_codes (user_id);
CREATE INDEX IF NOT EXISTS todos_linked_note_id_idx ON todos (linked_note_id);
CREATE INDEX IF NOT EXISTS note_comments_parent_idx ON note_comments (parent_id) WHERE parent_id IS NOT NULL;
