-- Comments and suggestions on a note (people on a share link write them too), the owner's notifications, and names for saved versions.
CREATE TABLE IF NOT EXISTS note_comments (
    id             TEXT PRIMARY KEY,
    note_id        TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE ON UPDATE CASCADE,
    parent_id      TEXT,
    kind           TEXT NOT NULL DEFAULT 'comment',
    author_name    TEXT NOT NULL,
    author_color   TEXT,
    author_user_id TEXT,
    author_session TEXT,
    body           TEXT NOT NULL DEFAULT '',
    quote          TEXT,
    replacement    TEXT,
    mentions       JSONB NOT NULL DEFAULT '[]'::jsonb,
    status         TEXT NOT NULL DEFAULT 'open',
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS note_comments_note_idx ON note_comments (note_id, created_at);

CREATE TABLE IF NOT EXISTS user_notifications (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL,
    kind       TEXT NOT NULL,
    note_id    TEXT,
    title      TEXT NOT NULL,
    body       TEXT,
    from_name  TEXT,
    is_read    BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS user_notifications_user_idx ON user_notifications (user_id, created_at DESC);

ALTER TABLE note_backups ADD COLUMN IF NOT EXISTS label TEXT;
ALTER TABLE note_backups ADD COLUMN IF NOT EXISTS saved_by TEXT;
