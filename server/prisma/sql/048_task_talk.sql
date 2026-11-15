-- Talking about a task (comments with @mentions, an activity trail) and "who is around" for a team.
CREATE TABLE IF NOT EXISTS task_comments (
    id         TEXT PRIMARY KEY,
    todo_id    TEXT NOT NULL REFERENCES todos(id) ON DELETE CASCADE ON UPDATE CASCADE,
    space_id   TEXT NOT NULL,
    user_id    TEXT NOT NULL,
    body       TEXT NOT NULL,
    mentions   JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS task_comments_todo_idx ON task_comments (todo_id, created_at);

CREATE TABLE IF NOT EXISTS task_activity (
    id         TEXT PRIMARY KEY,
    todo_id    TEXT NOT NULL REFERENCES todos(id) ON DELETE CASCADE ON UPDATE CASCADE,
    space_id   TEXT NOT NULL,
    user_id    TEXT NOT NULL,
    kind       TEXT NOT NULL,
    detail     TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS task_activity_space_idx ON task_activity (space_id, created_at DESC);
CREATE INDEX IF NOT EXISTS task_activity_todo_idx ON task_activity (todo_id, created_at);

CREATE TABLE IF NOT EXISTS member_availability (
    space_id   TEXT NOT NULL,
    user_id    TEXT NOT NULL,
    status     TEXT NOT NULL DEFAULT 'available',
    note       TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (space_id, user_id)
);
