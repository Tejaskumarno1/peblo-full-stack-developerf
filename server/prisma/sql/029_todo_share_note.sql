-- A shared task no longer shows its linked note unless the owner turns that on (default off, so existing links stop exposing notes).
ALTER TABLE todos ADD COLUMN IF NOT EXISTS share_note boolean NOT NULL DEFAULT false;
