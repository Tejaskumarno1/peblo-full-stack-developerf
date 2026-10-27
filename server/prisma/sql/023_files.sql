-- Files added to a note (PowerPoint, Word, Excel, PDF, anything up to 25 MB). The note holds a short address (/api/files/<id>);
-- the original bytes live here and are handed back exactly as they came in.
CREATE TABLE files (
  id TEXT PRIMARY KEY DEFAULT md5(random()::text || clock_timestamp()::text),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  data BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX files_user_idx ON files (user_id, created_at DESC);
