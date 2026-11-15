-- Workspaces, phase 1 "expand": only adds. Nothing existing is changed, moved or removed, so older app versions keep working.
-- An organization holds people and spaces; a space is a Team or the Office. Personal stays a person's own notes and is NOT a row here.
-- Existing rows keep space_id NULL, which means "Personal". Raw SQL, like ai_usage.
CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'read_only', 'closed')),
  policy JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS org_members (
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'guest')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused')),
  guest_until TIMESTAMPTZ,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, user_id)
);
CREATE INDEX IF NOT EXISTS org_members_user_idx ON org_members (user_id);

CREATE TABLE IF NOT EXISTS spaces (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('team', 'office')),
  name TEXT NOT NULL,
  default_role TEXT NOT NULL DEFAULT 'member' CHECK (default_role IN ('member', 'viewer')),
  allow_public_links BOOLEAN NOT NULL DEFAULT FALSE,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS spaces_org_idx ON spaces (org_id);

CREATE TABLE IF NOT EXISTS space_members (
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('lead', 'member', 'viewer')),
  added_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (space_id, user_id)
);
CREATE INDEX IF NOT EXISTS space_members_user_idx ON space_members (user_id);

CREATE TABLE IF NOT EXISTS org_invites (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email CITEXT NOT NULL,
  org_role TEXT NOT NULL DEFAULT 'member' CHECK (org_role IN ('admin', 'member', 'guest')),
  space_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  space_role TEXT NOT NULL DEFAULT 'member' CHECK (space_role IN ('lead', 'member', 'viewer')),
  token_hash TEXT NOT NULL,
  invited_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS org_invites_token_idx ON org_invites (token_hash);
CREATE INDEX IF NOT EXISTS org_invites_org_idx ON org_invites (org_id);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target TEXT,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_log_org_at_idx ON audit_log (org_id, at DESC);

ALTER TABLE notes ADD COLUMN IF NOT EXISTS space_id TEXT REFERENCES spaces(id) ON DELETE RESTRICT;

ALTER TABLE todos ADD COLUMN IF NOT EXISTS space_id TEXT REFERENCES spaces(id) ON DELETE RESTRICT;

ALTER TABLE todos ADD COLUMN IF NOT EXISTS assignee_id TEXT REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS notes_space_idx ON notes (space_id) WHERE space_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS todos_space_idx ON todos (space_id) WHERE space_id IS NOT NULL;
