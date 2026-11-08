-- Workspace notifications (office posts, suggestions, assigned tasks, joins) remember which space and task they are about.
ALTER TABLE user_notifications ADD COLUMN IF NOT EXISTS space_id TEXT;
ALTER TABLE user_notifications ADD COLUMN IF NOT EXISTS todo_id TEXT
