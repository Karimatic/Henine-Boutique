CREATE TABLE `cod_allocations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`remittance_id` integer NOT NULL,
	`order_id` integer NOT NULL,
	`amount` integer NOT NULL,
	FOREIGN KEY (`remittance_id`) REFERENCES `cod_remittances`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cod_allocations_uq` ON `cod_allocations` (`remittance_id`,`order_id`);--> statement-breakpoint
CREATE INDEX `cod_allocations_order_idx` ON `cod_allocations` (`order_id`);--> statement-breakpoint
CREATE TABLE `cod_remittances` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`received_on` text NOT NULL,
	`reference` text,
	`amount` integer NOT NULL,
	`note` text,
	`created_by` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`voided_at` integer,
	`voided_by` text,
	`void_reason` text
);
--> statement-breakpoint
CREATE INDEX `cod_remittances_date_idx` ON `cod_remittances` (`received_on`);--> statement-breakpoint
CREATE TABLE `delivery_followups` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`order_id` integer NOT NULL,
	`reason` text NOT NULL,
	`status` text DEFAULT 'needs_contact' NOT NULL,
	`attempts` integer DEFAULT 1 NOT NULL,
	`last_attempt_at` integer NOT NULL,
	`next_action_at` integer,
	`assigned_to` integer,
	`escalated` integer DEFAULT false NOT NULL,
	`note` text,
	`created_by` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`closed_at` integer,
	`closed_by` text,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`assigned_to`) REFERENCES `team_members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `delivery_followups_status_idx` ON `delivery_followups` (`status`,`next_action_at`);--> statement-breakpoint
CREATE INDEX `delivery_followups_order_idx` ON `delivery_followups` (`order_id`);--> statement-breakpoint
CREATE TABLE `expenses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`spent_on` text NOT NULL,
	`amount` integer NOT NULL,
	`currency` text DEFAULT 'DZD' NOT NULL,
	`category` text NOT NULL,
	`description` text NOT NULL,
	`payment_method` text,
	`reference` text,
	`receipt_key` text,
	`notes` text,
	`created_by` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_by` text,
	`updated_at` integer,
	`voided_at` integer,
	`voided_by` text,
	`void_reason` text
);
--> statement-breakpoint
CREATE INDEX `expenses_date_idx` ON `expenses` (`spent_on`);--> statement-breakpoint
CREATE INDEX `expenses_category_idx` ON `expenses` (`category`,`spent_on`);--> statement-breakpoint
CREATE TABLE `manifest_orders` (
	`manifest_id` integer NOT NULL,
	`order_id` integer NOT NULL,
	`cod_amount` integer NOT NULL,
	`fee` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`manifest_id`, `order_id`),
	FOREIGN KEY (`manifest_id`) REFERENCES `shipment_manifests`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `manifest_orders_order_idx` ON `manifest_orders` (`order_id`);--> statement-breakpoint
CREATE TABLE `order_duplicates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`order_id` integer NOT NULL,
	`other_order_id` integer NOT NULL,
	`score` integer NOT NULL,
	`reasons` text NOT NULL,
	`minutes_apart` integer NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`decided_by` text,
	`decided_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`other_order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `order_duplicates_pair_uq` ON `order_duplicates` (`order_id`,`other_order_id`);--> statement-breakpoint
CREATE INDEX `order_duplicates_status_idx` ON `order_duplicates` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `order_duplicates_other_idx` ON `order_duplicates` (`other_order_id`);--> statement-breakpoint
CREATE TABLE `order_finance` (
	`order_id` integer PRIMARY KEY NOT NULL,
	`collected` integer,
	`carrier_fee` integer,
	`return_fee` integer,
	`disputed` integer DEFAULT false NOT NULL,
	`note` text,
	`updated_by` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `shipment_manifests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`carrier` text DEFAULT 'ZR Express' NOT NULL,
	`handoff_ref` text,
	`note` text,
	`created_by` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`ready_at` integer,
	`handed_at` integer,
	`handed_by` text,
	`confirmed_at` integer,
	`confirmed_by` text,
	`cancelled_at` integer,
	`cancelled_by` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shipment_manifests_code_unique` ON `shipment_manifests` (`code`);--> statement-breakpoint
CREATE INDEX `shipment_manifests_status_idx` ON `shipment_manifests` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `stock_count_lines` (
	`count_id` integer NOT NULL,
	`variant_id` integer NOT NULL,
	`system_qty` integer NOT NULL,
	`counted_qty` integer,
	`reason` text,
	`note` text,
	`counted_by` text,
	`counted_at` integer,
	`applied_delta` integer,
	PRIMARY KEY(`count_id`, `variant_id`),
	FOREIGN KEY (`count_id`) REFERENCES `stock_counts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`variant_id`) REFERENCES `variants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `stock_counts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`scope` text NOT NULL,
	`scope_ref` text,
	`title` text NOT NULL,
	`status` text DEFAULT 'counting' NOT NULL,
	`note` text,
	`created_by` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`submitted_by` text,
	`submitted_at` integer,
	`decided_by` text,
	`decided_at` integer,
	`decision_note` text
);
--> statement-breakpoint
CREATE INDEX `stock_counts_status_idx` ON `stock_counts` (`status`,`created_at`);--> statement-breakpoint
ALTER TABLE `orders` ADD `source` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `landing_path` text;--> statement-breakpoint
CREATE INDEX `orders_source_created_idx` ON `orders` (`source`,`created_at`);--> statement-breakpoint
UPDATE `orders` SET `source` = CASE
  WHEN `channel` = 'boutique' THEN 'boutique'
  WHEN `channel` = 'instagram' THEN 'instagram'
  WHEN `channel` = 'whatsapp' THEN 'whatsapp'
  WHEN `channel` = 'telephone' THEN 'other'
  WHEN lower(`utm_source`) LIKE '%insta%' OR lower(`utm_source`) = 'ig' THEN 'instagram'
  WHEN lower(`utm_source`) LIKE '%facebook%' OR lower(`utm_source`) IN ('fb', 'meta') THEN 'facebook'
  WHEN lower(`utm_source`) LIKE '%tiktok%' THEN 'tiktok'
  WHEN lower(`utm_source`) LIKE '%google%' THEN 'google'
  WHEN lower(`utm_source`) LIKE '%whatsapp%' OR lower(`utm_source`) = 'wa' THEN 'whatsapp'
  WHEN lower(`utm_source`) = 'push' THEN 'push'
  WHEN lower(`utm_source`) = 'share' THEN 'referral'
  WHEN `utm_source` IS NOT NULL AND `utm_source` != '' AND lower(`utm_source`) != 'pwa' THEN 'campaign'
  ELSE 'direct' END
WHERE `source` IS NULL;
--> statement-breakpoint
UPDATE `roles` SET `permissions` = json_insert(`permissions`, '$[#]', 'stock.approve') WHERE `key` = 'manager' AND NOT EXISTS (SELECT 1 FROM json_each(`roles`.`permissions`) WHERE `value` = 'stock.approve');
--> statement-breakpoint
UPDATE `roles` SET `permissions` = json_insert(`permissions`, '$[#]', 'finance.view') WHERE `key` = 'manager' AND NOT EXISTS (SELECT 1 FROM json_each(`roles`.`permissions`) WHERE `value` = 'finance.view');
--> statement-breakpoint
UPDATE `roles` SET `permissions` = json_insert(`permissions`, '$[#]', 'finance.edit') WHERE `key` = 'manager' AND NOT EXISTS (SELECT 1 FROM json_each(`roles`.`permissions`) WHERE `value` = 'finance.edit');
