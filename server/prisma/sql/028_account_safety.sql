-- Account safety (additive; every statement can be re-run).
-- password_resets: one row per outstanding "forgot password" link. Only the SHA-256 of the link's secret is stored.
-- pending_signups: a sign-up waiting for its email link (used only when the server can send mail, so sign-up
-- never reveals whether an address already has an account). The account is created when the link is opened.
-- Both tables use row level security like the other late tables: the server connects as the owner and is not affected.
CREATE TABLE IF NOT EXISTS password_resets (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMP(3) NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS password_resets_user_idx ON password_resets (user_id);
CREATE INDEX IF NOT EXISTS password_resets_expires_idx ON password_resets (expires_at);
ALTER TABLE password_resets ENABLE ROW LEVEL SECURITY;
CREATE TABLE IF NOT EXISTS pending_signups (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMP(3) NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS pending_signups_expires_idx ON pending_signups (expires_at);
ALTER TABLE pending_signups ENABLE ROW LEVEL SECURITY;
-- Retention for anything left over from before this ran (the server also sweeps expired rows every hour).
DELETE FROM password_resets WHERE expires_at < CURRENT_TIMESTAMP - INTERVAL '1 day';
DELETE FROM pending_signups WHERE expires_at < CURRENT_TIMESTAMP - INTERVAL '1 day';
