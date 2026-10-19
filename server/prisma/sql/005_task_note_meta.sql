-- Extra details on a task or a note (task details, subtasks, estimates, labels, dependencies; note emoji, favourite...).
-- One JSON column each, checked and cleaned by the server before it is stored (see server/src/utils/meta.ts).
ALTER TABLE `todos` ADD COLUMN `meta` JSON NULL;

ALTER TABLE `notes` ADD COLUMN `meta` JSON NULL;
