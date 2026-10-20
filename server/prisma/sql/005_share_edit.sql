-- Share links can allow editing as well as reading.
ALTER TABLE notes ADD COLUMN share_edit BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE todos ADD COLUMN share_edit BOOLEAN NOT NULL DEFAULT false;
