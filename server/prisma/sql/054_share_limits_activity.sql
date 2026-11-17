-- Round 3 sharing (FM12, M13, FM22). Additive and idempotent.
-- FM12: per link "let guests copy and download" (no_copy = FALSE keeps today's behaviour: copying allowed).
ALTER TABLE share_settings ADD COLUMN IF NOT EXISTS no_copy BOOLEAN NOT NULL DEFAULT FALSE;
-- FM22: a signed-in person on a link is stored with their account id, so the page can show their real name and picture
-- and a guest's typed name can never pass for a member.
ALTER TABLE share_viewers ADD COLUMN IF NOT EXISTS user_id TEXT;
-- M13: who opened a link in the last 30 days (share_reads is already kept 30 days): how many visits, since when, and whether signed in.
ALTER TABLE share_reads ADD COLUMN IF NOT EXISTS user_id TEXT;
ALTER TABLE share_reads ADD COLUMN IF NOT EXISTS visits INTEGER NOT NULL DEFAULT 1;
CREATE INDEX IF NOT EXISTS share_reads_token_last_idx ON share_reads (kind, share_token, last_at DESC);
