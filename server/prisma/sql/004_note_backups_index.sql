-- Version history lists a note's newest versions first (PEB-83).
CREATE INDEX `note_backups_note_id_created_at_idx` ON `note_backups`(`note_id`, `created_at`);
