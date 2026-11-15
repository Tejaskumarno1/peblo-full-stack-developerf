-- Delete organization (R16): the organization is soft-closed (status 'closed', closed_at set) and its data is kept until purge_after (30 days later).
-- Nothing is physically deleted by this change; a later purge job reads this column.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS purge_after TIMESTAMPTZ;
