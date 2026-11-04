CREATE TABLE `memberships` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`subscription_id` integer NOT NULL,
	`participant_id` integer NOT NULL,
	`weight` integer DEFAULT 1 NOT NULL,
	`valid_from_month` text NOT NULL,
	`valid_to_month` text,
	FOREIGN KEY (`subscription_id`) REFERENCES `subscriptions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`participant_id`) REFERENCES `participants`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "memberships_weight_ck" CHECK("memberships"."weight" >= 1),
	CONSTRAINT "memberships_range_ck" CHECK("memberships"."valid_to_month" IS NULL OR "memberships"."valid_to_month" >= "memberships"."valid_from_month")
);
--> statement-breakpoint
CREATE INDEX `memberships_sub_idx` ON `memberships` (`subscription_id`);--> statement-breakpoint
CREATE INDEX `memberships_participant_idx` ON `memberships` (`participant_id`);--> statement-breakpoint
CREATE TABLE `participants` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`display_name` text NOT NULL,
	`email` text,
	`is_owner` integer DEFAULT false NOT NULL,
	`token_hash` text NOT NULL,
	`token_revoked_at` text,
	`reminders_enabled` integer DEFAULT true NOT NULL,
	`unsubscribe_token_hash` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `participants_token_hash_unique` ON `participants` (`token_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `participants_unsubscribe_token_hash_unique` ON `participants` (`unsubscribe_token_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `participants_single_owner_uq` ON `participants` (`is_owner`) WHERE "participants"."is_owner" = 1;--> statement-breakpoint
CREATE TABLE `payments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`participant_id` integer NOT NULL,
	`month` text NOT NULL,
	`reference_id` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`marked_paid_at` text,
	`confirmed_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`participant_id`) REFERENCES `participants`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "payments_amount_ck" CHECK("payments"."amount_cents" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payments_participant_month_uq` ON `payments` (`participant_id`,`month`);--> statement-breakpoint
CREATE UNIQUE INDEX `payments_reference_uq` ON `payments` (`reference_id`);--> statement-breakpoint
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
	`name` text NOT NULL,
	`currency` text DEFAULT 'EUR' NOT NULL,
	`archived_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
