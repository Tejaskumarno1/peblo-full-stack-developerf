-- Text for pictures, so bots and screen readers can read what a picture shows (made on demand with the owner's AI, kept here).
ALTER TABLE media ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE media ADD COLUMN IF NOT EXISTS described_at TIMESTAMPTZ;
