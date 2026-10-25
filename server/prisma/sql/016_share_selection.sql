-- Where a person's selection starts and ends inside the block their caret is in (character offsets).
ALTER TABLE share_viewers ADD COLUMN IF NOT EXISTS sel_start INTEGER;
ALTER TABLE share_viewers ADD COLUMN IF NOT EXISTS sel_end INTEGER;
