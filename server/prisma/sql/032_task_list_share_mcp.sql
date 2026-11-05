-- A list link can also be offered to AI agents over MCP, but only when the owner turns that on for the list.
ALTER TABLE task_list_shares ADD COLUMN IF NOT EXISTS mcp_enabled BOOLEAN NOT NULL DEFAULT FALSE;
