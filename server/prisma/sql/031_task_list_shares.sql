-- Sharing a whole task list: one link per list, what people with it may do, who used it, and their comments.
CREATE TABLE IF NOT EXISTS task_list_shares (
  token         TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  list_name     TEXT NOT NULL,
  perm          TEXT NOT NULL DEFAULT 'view',
  expires_at    TIMESTAMP(3),
  show_progress BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, list_name)
);
CREATE TABLE IF NOT EXISTS task_list_guests (
  token      TEXT NOT NULL,
  session_id TEXT NOT NULL,
  name       TEXT NOT NULL DEFAULT 'Guest',
  last_act   TEXT,
  last_at    TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  PRIMARY KEY (token, session_id)
);
CREATE TABLE IF NOT EXISTS task_list_comments (
  id      TEXT PRIMARY KEY,
  token   TEXT NOT NULL,
  todo_id TEXT NOT NULL,
  author  TEXT NOT NULL,
  body    TEXT NOT NULL,
  at      TIMESTAMP(3) NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS task_list_comments_idx ON task_list_comments (token, todo_id);
ALTER TABLE task_list_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_list_guests ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_list_comments ENABLE ROW LEVEL SECURITY;
