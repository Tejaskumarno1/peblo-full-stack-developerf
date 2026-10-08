-- Encrypted keys are longer than the old VARCHAR(191) columns.
ALTER TABLE `user_api_keys` MODIFY `openai_key` TEXT NULL;
ALTER TABLE `user_api_keys` MODIFY `gemini_key` TEXT NULL;
ALTER TABLE `user_api_keys` MODIFY `groq_key` TEXT NULL;
ALTER TABLE `user_api_keys` MODIFY `huggingface_key` TEXT NULL;

-- Bumping this signs the account out on every device (change password / "sign out everywhere").
ALTER TABLE `users` ADD COLUMN `token_version` INTEGER NOT NULL DEFAULT 0;
