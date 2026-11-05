CREATE TABLE `standing_orders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`payer_user_id` integer NOT NULL,
	`recipient_user_id` integer NOT NULL,
	`from_month` text NOT NULL,
	`created_by_user_id` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`payer_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`recipient_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "standing_orders_month_ck" CHECK("standing_orders"."from_month" LIKE '____-__'),
	CONSTRAINT "standing_orders_not_self_ck" CHECK("standing_orders"."payer_user_id" <> "standing_orders"."recipient_user_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `standing_orders_pair_uq` ON `standing_orders` (`payer_user_id`,`recipient_user_id`);--> statement-breakpoint
ALTER TABLE `payments` ADD `standing_order_state` text;