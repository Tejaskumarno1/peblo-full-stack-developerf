-- A token is either 'full' (read and write) or 'read' (GET requests only).
ALTER TABLE api_tokens ADD COLUMN scope TEXT NOT NULL DEFAULT 'full';
