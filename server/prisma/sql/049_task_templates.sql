-- Task templates a team keeps (a ready set of tasks with relative days).
CREATE TABLE IF NOT EXISTS task_templates (
    id         TEXT PRIMARY KEY,
    space_id   TEXT NOT NULL,
    name       TEXT NOT NULL,
    items      JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS task_templates_space_idx ON task_templates (space_id);
