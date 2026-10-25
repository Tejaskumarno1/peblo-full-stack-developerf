-- Live co-editing (Yjs): the merged state of a note's document, so a restart or a quiet room loses nothing.
-- md_hash says which saved text of the note this state matches. If the note was changed some other way
-- (the API, an AI tool, an older window) the hashes differ and the state is rebuilt from the saved text.
CREATE TABLE IF NOT EXISTS note_ydocs (
    note_id TEXT NOT NULL PRIMARY KEY REFERENCES notes(id) ON DELETE CASCADE ON UPDATE CASCADE,
    state BYTEA NOT NULL,
    md_hash TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
