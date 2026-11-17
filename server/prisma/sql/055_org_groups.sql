-- FM23 groups: named groups of organization members. Owners and admins manage them; a group can be given a task
-- (every member who is in the task's team becomes an assignee) or an Office note (each member gets their own access row).
-- Raw SQL like the other organization tables (not in schema.prisma, audit M20). Additive and idempotent.
CREATE TABLE IF NOT EXISTS org_groups (
  id          TEXT PRIMARY KEY,
  org_id      TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  created_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMP(3) NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS org_groups_org_name_idx ON org_groups (org_id, lower(name));

CREATE TABLE IF NOT EXISTS org_group_members (
  group_id  TEXT NOT NULL REFERENCES org_groups(id) ON DELETE CASCADE,
  user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  added_at  TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  PRIMARY KEY (group_id, user_id)
);
CREATE INDEX IF NOT EXISTS org_group_members_user_idx ON org_group_members (user_id);

ALTER TABLE org_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_group_members ENABLE ROW LEVEL SECURITY;
