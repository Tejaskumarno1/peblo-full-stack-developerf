-- How many AI requests each person's connections answered, per day, so Settings can show a usage meter.
-- Only counts are kept (never the text of a request or a reply). Table is read and written with raw SQL.
CREATE TABLE IF NOT EXISTS ai_usage (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day DATE NOT NULL,
  provider TEXT NOT NULL,
  feature TEXT NOT NULL DEFAULT 'other',
  requests INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day, provider, feature)
);
CREATE INDEX IF NOT EXISTS ai_usage_user_day_idx ON ai_usage (user_id, day);
