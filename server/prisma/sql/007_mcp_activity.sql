-- What connected apps (Claude, Cursor...) did through the MCP server, so the person can see it in Settings.
CREATE TABLE mcp_activity (
  id TEXT PRIMARY KEY DEFAULT md5(random()::text || clock_timestamp()::text),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  app TEXT NOT NULL,
  tool TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  ok BOOLEAN NOT NULL DEFAULT true,
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX mcp_activity_user_at_idx ON mcp_activity (user_id, at DESC);
