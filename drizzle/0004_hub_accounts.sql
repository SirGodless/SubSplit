CREATE TABLE `sessions` (
	`id_hash` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`hub_sid` text,
	`csrf` text NOT NULL,
	`refresh_token` text,
	`operator` integer DEFAULT false NOT NULL,
	`check_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `sessions_hub_sid_idx` ON `sessions` (`hub_sid`);--> statement-breakpoint
DROP TABLE `email_verifications`;--> statement-breakpoint
DROP TABLE `invitations`;--> statement-breakpoint
DROP INDEX `users_username_unique`;--> statement-breakpoint
DROP INDEX `users_setup_token_hash_unique`;--> statement-breakpoint
ALTER TABLE `users` ADD `sub` text;--> statement-breakpoint
ALTER TABLE `users` ADD `legacy_username` text;--> statement-breakpoint
ALTER TABLE `users` ADD `legacy_display_name` text;--> statement-breakpoint
CREATE UNIQUE INDEX `users_sub_unique` ON `users` (`sub`);--> statement-breakpoint
-- Namen aus der Zeit vor dem Hub merken, damit sich ein Konto mit scripts/link-user.mjs dem Hub-Konto zuordnen lässt
UPDATE `users` SET `legacy_username` = `username`, `legacy_display_name` = `display_name`;--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `username`;--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `display_name`;--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `email`;--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `email_verified_at`;--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `role`;--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `password_hash`;--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `session_version`;--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `setup_token_hash`;--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `setup_expires_at`;--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `disabled_at`;