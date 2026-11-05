CREATE TABLE `memberships` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`subscription_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`weight` integer DEFAULT 1 NOT NULL,
	`valid_from_month` text NOT NULL,
	`valid_to_month` text,
	FOREIGN KEY (`subscription_id`) REFERENCES `subscriptions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "memberships_weight_ck" CHECK("memberships"."weight" >= 1),
	CONSTRAINT "memberships_range_ck" CHECK("memberships"."valid_to_month" IS NULL OR "memberships"."valid_to_month" >= "memberships"."valid_from_month")
);
--> statement-breakpoint
CREATE INDEX `memberships_sub_idx` ON `memberships` (`subscription_id`);--> statement-breakpoint
CREATE INDEX `memberships_user_idx` ON `memberships` (`user_id`);--> statement-breakpoint
CREATE TABLE `payments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`payer_user_id` integer NOT NULL,
	`recipient_user_id` integer NOT NULL,
	`month` text NOT NULL,
	`reference_id` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`marked_paid_at` text,
	`confirmed_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`payer_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`recipient_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "payments_amount_ck" CHECK("payments"."amount_cents" >= 0),
	CONSTRAINT "payments_not_self_ck" CHECK("payments"."payer_user_id" <> "payments"."recipient_user_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payments_payer_recipient_month_uq` ON `payments` (`payer_user_id`,`recipient_user_id`,`month`);--> statement-breakpoint
CREATE UNIQUE INDEX `payments_reference_uq` ON `payments` (`reference_id`);--> statement-breakpoint
CREATE INDEX `payments_recipient_month_idx` ON `payments` (`recipient_user_id`,`month`);--> statement-breakpoint
CREATE TABLE `reminder_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`payment_id` integer NOT NULL,
	`sent_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`status` text NOT NULL,
	`error` text,
	FOREIGN KEY (`payment_id`) REFERENCES `payments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `reminder_log_payment_idx` ON `reminder_log` (`payment_id`);--> statement-breakpoint
CREATE TABLE `subscription_prices` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`subscription_id` integer NOT NULL,
	`valid_from_month` text NOT NULL,
	`amount_cents` integer NOT NULL,
	FOREIGN KEY (`subscription_id`) REFERENCES `subscriptions`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "subscription_prices_amount_ck" CHECK("subscription_prices"."amount_cents" >= 0),
	CONSTRAINT "subscription_prices_month_ck" CHECK("subscription_prices"."valid_from_month" LIKE '____-__')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `subscription_prices_sub_month_uq` ON `subscription_prices` (`subscription_id`,`valid_from_month`);--> statement-breakpoint
CREATE TABLE `subscriptions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_user_id` integer NOT NULL,
	`name` text NOT NULL,
	`currency` text DEFAULT 'EUR' NOT NULL,
	`archived_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `subscriptions_owner_idx` ON `subscriptions` (`owner_user_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`display_name` text NOT NULL,
	`email` text,
	`role` text DEFAULT 'user' NOT NULL,
	`password_hash` text,
	`session_version` integer DEFAULT 0 NOT NULL,
	`setup_token_hash` text,
	`setup_expires_at` text,
	`disabled_at` text,
	`recipient_name` text,
	`paypal_me` text,
	`iban` text,
	`due_day` integer DEFAULT 1 NOT NULL,
	`reminders_enabled` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`last_login_at` text,
	CONSTRAINT "users_due_day_ck" CHECK("users"."due_day" BETWEEN 1 AND 28)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_setup_token_hash_unique` ON `users` (`setup_token_hash`);