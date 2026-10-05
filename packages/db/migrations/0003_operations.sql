CREATE TABLE `alerts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`priority` text NOT NULL,
	`entity` text,
	`entity_id` text,
	`message` text NOT NULL,
	`dedupe_key` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`read_at` integer,
	`resolved_at` integer,
	`resolved_by` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `alerts_dedupe_key_unique` ON `alerts` (`dedupe_key`);--> statement-breakpoint
CREATE INDEX `alerts_open_idx` ON `alerts` (`resolved_at`,`priority`,`created_at`);--> statement-breakpoint
CREATE TABLE `exchange_requests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`order_id` integer NOT NULL,
	`order_item_id` integer NOT NULL,
	`from_variant_id` integer,
	`to_variant_id` integer NOT NULL,
	`reason` text NOT NULL,
	`note` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`decided_by` text,
	`decision_note` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`decided_at` integer,
	`completed_at` integer,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`order_item_id`) REFERENCES `order_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`to_variant_id`) REFERENCES `variants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `exchange_requests_status_idx` ON `exchange_requests` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `exchange_requests_order_idx` ON `exchange_requests` (`order_id`);--> statement-breakpoint
CREATE TABLE `order_changes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`order_id` integer NOT NULL,
	`field` text NOT NULL,
	`old_value` text,
	`new_value` text,
	`reason` text,
	`actor` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `order_changes_order_idx` ON `order_changes` (`order_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `customers` ADD `contact_time` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `contact_time` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `manual_discount` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `manual_discount_reason` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `received_at` integer;--> statement-breakpoint
ALTER TABLE `orders` ADD `receipt_issue` text;--> statement-breakpoint
ALTER TABLE `team_members` ADD `orders_seen_at` integer;--> statement-breakpoint
UPDATE `roles` SET `permissions` = json_insert(`permissions`, '$[#]', 'orders.discount') WHERE `key` = 'manager' AND NOT EXISTS (SELECT 1 FROM json_each(`roles`.`permissions`) WHERE `value` = 'orders.discount');
