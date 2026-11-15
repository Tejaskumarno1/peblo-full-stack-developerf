-- Safer invites: when the invitee last asked for a new invite (one reminder per invite per 24 hours).
ALTER TABLE org_invites ADD COLUMN IF NOT EXISTS last_reminded_at TIMESTAMPTZ;

-- Mute a team: one row per person per space. Muted spaces send no stored notifications and no live nudges (direct @mentions and tasks assigned to you still do).
CREATE TABLE IF NOT EXISTS space_prefs (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  muted BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, space_id)
);

CREATE INDEX IF NOT EXISTS space_prefs_space_idx ON space_prefs (space_id)
