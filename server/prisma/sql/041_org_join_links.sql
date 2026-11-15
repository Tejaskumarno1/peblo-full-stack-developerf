-- Expiring join links for an Office (mockups WsE04 to WsE06). Anyone signed in with a verified email who opens the link joins the organization as a member and the Office.
-- Only a hash of the token is used to look a link up; the token itself is kept encrypted so an admin can copy the link again.
CREATE TABLE IF NOT EXISTS org_join_links (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  space_role TEXT NOT NULL DEFAULT 'member' CHECK (space_role IN ('member', 'viewer')),
  token_hash TEXT NOT NULL UNIQUE,
  token_enc TEXT,
  max_uses INTEGER CHECK (max_uses IS NULL OR max_uses > 0),
  uses INTEGER NOT NULL DEFAULT 0,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS org_join_links_org_idx ON org_join_links (org_id);
