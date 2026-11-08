-- Organization AI keys (mockup C05). The secret is encrypted with the same helper as personal keys and is never returned by the API.
CREATE TABLE IF NOT EXISTS org_ai_keys (
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  secret TEXT NOT NULL,
  added_by TEXT,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, provider)
);
