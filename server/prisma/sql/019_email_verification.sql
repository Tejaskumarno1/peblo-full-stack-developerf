-- Email verification: when a person proved they own their address, and the one-time links that prove it
-- (kind 'verify' = confirm the current address, 'change' = move the account to new_email). Only a hash of each link's secret is kept.
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMP(3);
CREATE TABLE IF NOT EXISTS email_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  new_email TEXT,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMP(3) NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS email_tokens_user_idx ON email_tokens (user_id, kind);
