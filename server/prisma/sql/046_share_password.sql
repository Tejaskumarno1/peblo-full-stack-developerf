-- Password on a share link (S27): a salted scrypt hash, never the password itself.
ALTER TABLE share_settings ADD COLUMN IF NOT EXISTS pw_hash TEXT;
