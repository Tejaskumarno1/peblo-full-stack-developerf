-- Peblo on Postgres (Supabase). Case-insensitive names use CITEXT so "Work" and "work" are one tag, like they were on MySQL.
CREATE EXTENSION IF NOT EXISTS citext WITH SCHEMA public;

CREATE TABLE users (
    id TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT 'You',
    email CITEXT NOT NULL,
    password_hash TEXT NOT NULL,
    token_version INTEGER NOT NULL DEFAULT 0,
    job_title TEXT NULL,
    bio TEXT NULL,
    timezone TEXT NOT NULL DEFAULT 'UTC',
    settings JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP(3) NOT NULL,
    CONSTRAINT users_pkey PRIMARY KEY (id)
);
CREATE UNIQUE INDEX users_email_key ON users(email);

CREATE TABLE notes (
    id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT 'Untitled',
    content TEXT NOT NULL DEFAULT '',
    category TEXT NULL,
    is_archived BOOLEAN NOT NULL DEFAULT false,
    is_deleted BOOLEAN NOT NULL DEFAULT false,
    deleted_at TIMESTAMP(3) NULL,
    meta JSONB NULL,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP(3) NOT NULL,
    CONSTRAINT notes_pkey PRIMARY KEY (id)
);
CREATE INDEX notes_user_id_idx ON notes(user_id);
CREATE INDEX notes_user_id_is_archived_idx ON notes(user_id, is_archived);
CREATE INDEX notes_user_id_is_deleted_idx ON notes(user_id, is_deleted);
CREATE INDEX notes_user_id_category_idx ON notes(user_id, category);
CREATE INDEX notes_user_id_updated_at_idx ON notes(user_id, updated_at DESC);

CREATE TABLE tags (
    id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    name CITEXT NOT NULL,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT tags_pkey PRIMARY KEY (id)
);
CREATE UNIQUE INDEX tags_user_id_name_key ON tags(user_id, name);

CREATE TABLE note_tags (
    note_id TEXT NOT NULL,
    tag_id TEXT NOT NULL,
    CONSTRAINT note_tags_pkey PRIMARY KEY (note_id, tag_id)
);
CREATE INDEX note_tags_tag_id_idx ON note_tags(tag_id);

CREATE TABLE ai_generations (
    id TEXT NOT NULL,
    note_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    type TEXT NOT NULL,
    result TEXT NOT NULL,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ai_generations_pkey PRIMARY KEY (id)
);
CREATE INDEX ai_generations_user_id_idx ON ai_generations(user_id);
CREATE INDEX ai_generations_note_id_idx ON ai_generations(note_id);

CREATE TABLE note_backups (
    id TEXT NOT NULL,
    note_id TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT note_backups_pkey PRIMARY KEY (id)
);
CREATE INDEX note_backups_note_id_created_at_idx ON note_backups(note_id, created_at);

CREATE TABLE todo_series (
    id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    recurrence TEXT NOT NULL,
    timezone VARCHAR(64) NOT NULL,
    anchor TIMESTAMP(3) NOT NULL,
    last_generated TIMESTAMP(3) NOT NULL,
    ended_at TIMESTAMP(3) NULL,
    text TEXT NOT NULL,
    priority TEXT NOT NULL DEFAULT 'medium',
    tags JSONB NOT NULL DEFAULT '[]'::jsonb,
    start_time TEXT NULL,
    end_time TEXT NULL,
    linked_note_id TEXT NULL,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT todo_series_pkey PRIMARY KEY (id)
);
CREATE INDEX todo_series_user_id_idx ON todo_series(user_id);

CREATE TABLE todos (
    id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    text TEXT NOT NULL,
    is_completed BOOLEAN NOT NULL DEFAULT false,
    priority TEXT NOT NULL DEFAULT 'medium',
    deadline TIMESTAMP(3) NULL,
    tags JSONB NOT NULL DEFAULT '[]'::jsonb,
    linked_note_id TEXT NULL,
    start_time TEXT NULL,
    end_time TEXT NULL,
    recurrence TEXT NULL DEFAULT 'none',
    series_id TEXT NULL,
    meta JSONB NULL,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP(3) NOT NULL,
    CONSTRAINT todos_pkey PRIMARY KEY (id)
);
CREATE INDEX todos_user_id_idx ON todos(user_id);
CREATE INDEX todos_user_id_deadline_idx ON todos(user_id, deadline);
CREATE INDEX todos_user_id_is_completed_idx ON todos(user_id, is_completed);
CREATE INDEX todos_series_id_idx ON todos(series_id);

CREATE TABLE note_embeddings (
    id TEXT NOT NULL,
    note_id TEXT NOT NULL,
    vector TEXT NOT NULL,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT note_embeddings_pkey PRIMARY KEY (id)
);
CREATE UNIQUE INDEX note_embeddings_note_id_key ON note_embeddings(note_id);

CREATE TABLE user_api_keys (
    user_id TEXT NOT NULL,
    openai_key TEXT NULL,
    gemini_key TEXT NULL,
    groq_key TEXT NULL,
    huggingface_key TEXT NULL,
    updated_at TIMESTAMP(3) NOT NULL,
    CONSTRAINT user_api_keys_pkey PRIMARY KEY (user_id)
);

CREATE TABLE quiz_runs (
    id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    topic CITEXT NOT NULL,
    questions TEXT NOT NULL,
    answers TEXT NULL,
    correct INTEGER NULL,
    total INTEGER NOT NULL,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finished_at TIMESTAMP(3) NULL,
    CONSTRAINT quiz_runs_pkey PRIMARY KEY (id)
);
CREATE INDEX quiz_runs_user_id_topic_idx ON quiz_runs(user_id, topic);

CREATE TABLE topic_mastery (
    user_id TEXT NOT NULL,
    topic CITEXT NOT NULL,
    score INTEGER NOT NULL,
    quizzes INTEGER NOT NULL DEFAULT 0,
    last_correct INTEGER NOT NULL DEFAULT 0,
    last_total INTEGER NOT NULL DEFAULT 0,
    missed TEXT NOT NULL DEFAULT '[]',
    updated_at TIMESTAMP(3) NOT NULL,
    CONSTRAINT topic_mastery_pkey PRIMARY KEY (user_id, topic)
);

ALTER TABLE notes ADD CONSTRAINT notes_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE tags ADD CONSTRAINT tags_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE note_tags ADD CONSTRAINT note_tags_note_id_fkey FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE note_tags ADD CONSTRAINT note_tags_tag_id_fkey FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE ai_generations ADD CONSTRAINT ai_generations_note_id_fkey FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE ai_generations ADD CONSTRAINT ai_generations_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE note_backups ADD CONSTRAINT note_backups_note_id_fkey FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE todo_series ADD CONSTRAINT todo_series_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE todos ADD CONSTRAINT todos_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE todos ADD CONSTRAINT todos_linked_note_id_fkey FOREIGN KEY (linked_note_id) REFERENCES notes(id) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE todos ADD CONSTRAINT todos_series_id_fkey FOREIGN KEY (series_id) REFERENCES todo_series(id) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE note_embeddings ADD CONSTRAINT note_embeddings_note_id_fkey FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE user_api_keys ADD CONSTRAINT user_api_keys_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE quiz_runs ADD CONSTRAINT quiz_runs_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE topic_mastery ADD CONSTRAINT topic_mastery_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE;

-- The app talks to this database only through the server, never straight from a browser, so block the public API.
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE note_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_generations ENABLE ROW LEVEL SECURITY;
ALTER TABLE note_backups ENABLE ROW LEVEL SECURITY;
ALTER TABLE todo_series ENABLE ROW LEVEL SECURITY;
ALTER TABLE todos ENABLE ROW LEVEL SECURITY;
ALTER TABLE note_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE quiz_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE topic_mastery ENABLE ROW LEVEL SECURITY;
