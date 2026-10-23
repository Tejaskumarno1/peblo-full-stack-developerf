-- Pictures pasted or dropped into notes. They used to be written into the note text as base64, which made notes heavy.
-- Now a note holds a short address (/api/media/<id>) and the picture lives here (WebP, made by the app).
CREATE TABLE media (
  id TEXT PRIMARY KEY DEFAULT md5(random()::text || clock_timestamp()::text),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  data BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX media_user_idx ON media (user_id, created_at DESC);

-- Share links can expire.
ALTER TABLE notes ADD COLUMN share_expires_at TIMESTAMPTZ;
ALTER TABLE todos ADD COLUMN share_expires_at TIMESTAMPTZ;
