-- A repeating task is one series row (the rule + the task details) that keeps generating its next occurrences.
CREATE TABLE `todo_series` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `recurrence` VARCHAR(191) NOT NULL,
    `timezone` VARCHAR(64) NOT NULL,
    `anchor` DATETIME(3) NOT NULL,
    `last_generated` DATETIME(3) NOT NULL,
    `ended_at` DATETIME(3) NULL,
    `text` TEXT NOT NULL,
    `priority` VARCHAR(191) NOT NULL DEFAULT 'medium',
    `tags` JSON NOT NULL DEFAULT ('[]'),
    `start_time` VARCHAR(191) NULL,
    `end_time` VARCHAR(191) NULL,
    `linked_note_id` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `todo_series_user_id_idx`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `todo_series` ADD CONSTRAINT `todo_series_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `todos` ADD COLUMN `series_id` VARCHAR(191) NULL;

CREATE INDEX `todos_series_id_idx` ON `todos`(`series_id`);

ALTER TABLE `todos` ADD CONSTRAINT `todos_series_id_fkey` FOREIGN KEY (`series_id`) REFERENCES `todo_series`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
