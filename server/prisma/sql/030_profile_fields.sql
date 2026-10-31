-- Profile page fields (additive; every statement can be re-run).
-- username: the handle people can be found by (case-insensitive, unique, optional).
-- pronouns / language: shown on the profile. password_changed_at: "Last changed ..." on the security card.
-- deletion_requested_at: set when the person asks to delete the account; the server removes the account 30 days later
-- unless they sign in again before then (signing in cancels the request).
ALTER TABLE users ADD COLUMN IF NOT EXISTS username citext;
CREATE UNIQUE INDEX IF NOT EXISTS users_username_key ON users (username);
ALTER TABLE users ADD COLUMN IF NOT EXISTS pronouns text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS language text NOT NULL DEFAULT 'en';
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at timestamp(3);
ALTER TABLE users ADD COLUMN IF NOT EXISTS deletion_requested_at timestamp(3);
CREATE INDEX IF NOT EXISTS users_deletion_requested_idx ON users (deletion_requested_at) WHERE deletion_requested_at IS NOT NULL;
