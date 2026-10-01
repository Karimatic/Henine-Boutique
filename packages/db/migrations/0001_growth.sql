ALTER TABLE `carts` ADD `commune_id` integer;--> statement-breakpoint
ALTER TABLE `carts` ADD `delivery_type` text;--> statement-breakpoint
ALTER TABLE `carts` ADD `channel` text;--> statement-breakpoint
ALTER TABLE `carts` ADD `locale` text;--> statement-breakpoint
ALTER TABLE `collections` ADD `description_fr` text;--> statement-breakpoint
ALTER TABLE `collections` ADD `description_ar` text;--> statement-breakpoint
ALTER TABLE `collections` ADD `starts_at` integer;--> statement-breakpoint
ALTER TABLE `collections` ADD `ends_at` integer;--> statement-breakpoint
ALTER TABLE `collections` ADD `show_countdown` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `collections` ADD `lock_products` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `collections` ADD `sort` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `collections` ADD `created_at` integer;--> statement-breakpoint
ALTER TABLE `communes` ADD `home_price` integer;--> statement-breakpoint
ALTER TABLE `customers` ADD `fake_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `risk_flags` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `outcome_reason` text;--> statement-breakpoint
CREATE INDEX `orders_created_idx` ON `orders` (`created_at`);--> statement-breakpoint
CREATE INDEX `orders_wilaya_created_idx` ON `orders` (`wilaya_code`,`created_at`);--> statement-breakpoint
ALTER TABLE `products` ADD `published_at` integer;--> statement-breakpoint
ALTER TABLE `products` ADD `related_ids` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
CREATE INDEX `order_items_product_idx` ON `order_items` (`product_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `reviews_order_product_uq` ON `reviews` (`order_id`,`product_id`);--> statement-breakpoint
-- Backfill (existing data is kept; these only fill the new columns)
UPDATE `products` SET `published_at` = `created_at` WHERE `published_at` IS NULL AND `status` = 'published';--> statement-breakpoint
UPDATE `customers` SET `fake_count` = (SELECT COUNT(*) FROM `orders` o WHERE o.`customer_id` = `customers`.`id` AND o.`status` = 'fausse');--> statement-breakpoint
UPDATE `collections` SET `created_at` = (unixepoch() * 1000) WHERE `created_at` IS NULL;
