-- Who is typing right now in a shared note (shown as "Alex is typing…"). Old rows simply have no value.
ALTER TABLE share_viewers ADD COLUMN IF NOT EXISTS typing_at TIMESTAMP(3);
