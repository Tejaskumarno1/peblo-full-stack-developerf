-- A viewer asking the owner for edit access (S28): who, and the message they wrote.
ALTER TABLE share_settings ADD COLUMN IF NOT EXISTS edit_ask_at TIMESTAMP(3);
ALTER TABLE share_settings ADD COLUMN IF NOT EXISTS edit_ask_by TEXT;
ALTER TABLE share_settings ADD COLUMN IF NOT EXISTS edit_ask_msg TEXT;
