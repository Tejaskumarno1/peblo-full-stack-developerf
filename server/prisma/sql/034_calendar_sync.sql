-- Calendar links (read-only iCal feeds a person subscribes to) and the two links Peblo hands out for a person's own calendar.
-- Events of a link are a cache of what the other calendar said; deleting a link only forgets the cache. Raw SQL, like ai_usage.
CREATE TABLE IF NOT EXISTS calendar_feeds (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT 'sky',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  events JSONB NOT NULL DEFAULT '[]'::jsonb,
  last_synced_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS calendar_feeds_user_idx ON calendar_feeds (user_id);

CREATE TABLE IF NOT EXISTS calendar_share (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  feed_token TEXT NOT NULL,
  feed_on BOOLEAN NOT NULL DEFAULT FALSE,
  free_token TEXT NOT NULL,
  free_on BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE UNIQUE INDEX IF NOT EXISTS calendar_share_feed_idx ON calendar_share (feed_token);
CREATE UNIQUE INDEX IF NOT EXISTS calendar_share_free_idx ON calendar_share (free_token);
