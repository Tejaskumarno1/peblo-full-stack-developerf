-- Board columns for the Kanban view, one set per space (or per person for Personal): scope is the space id or 'u:' + the user id.
CREATE TABLE IF NOT EXISTS board_columns (
  scope TEXT PRIMARY KEY,
  columns JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
