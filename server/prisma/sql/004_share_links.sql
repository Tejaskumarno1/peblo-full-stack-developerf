-- Share links: a note or a task can have a secret link that anyone can open (read only).
ALTER TABLE notes ADD COLUMN share_token TEXT;
CREATE UNIQUE INDEX notes_share_token_key ON notes (share_token);
ALTER TABLE todos ADD COLUMN share_token TEXT;
CREATE UNIQUE INDEX todos_share_token_key ON todos (share_token);
