-- A short summary the owner writes for readers (S01 "Summary by <owner>").
ALTER TABLE share_settings ADD COLUMN IF NOT EXISTS summary TEXT;
