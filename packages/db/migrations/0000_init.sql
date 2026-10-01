CREATE TABLE `admin_sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`member_id` integer NOT NULL,
	`token_hash` text NOT NULL,
	`user_agent` text,
	`ip_hash` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`last_seen_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `team_members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `admin_sessions_token_hash_unique` ON `admin_sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `admin_sessions_member_idx` ON `admin_sessions` (`member_id`);--> statement-breakpoint
CREATE TABLE `analytics_daily` (
	`date` text NOT NULL,
	`metric` text NOT NULL,
	`dim` text DEFAULT '' NOT NULL,
	`value` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`date`, `metric`, `dim`)
);
--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`entity` text NOT NULL,
	`entity_id` text,
	`diff` text,
	`ip_hash` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_entity_idx` ON `audit_log` (`entity`,`entity_id`);--> statement-breakpoint
CREATE INDEX `audit_created_idx` ON `audit_log` (`created_at`);--> statement-breakpoint
CREATE TABLE `auth_challenges` (
	`id` text PRIMARY KEY NOT NULL,
	`member_id` integer NOT NULL,
	`purpose` text NOT NULL,
	`code_hash` text NOT NULL,
	`pending_hash` text,
	`pending_salt` text,
	`remember` integer DEFAULT false NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`expires_at` integer NOT NULL,
	`consumed_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `team_members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `auth_challenges_member_idx` ON `auth_challenges` (`member_id`);--> statement-breakpoint
CREATE TABLE `campaigns` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`config` text NOT NULL,
	`segment` text,
	`scheduled_at` integer,
	`status` text DEFAULT 'draft' NOT NULL,
	`stats` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `carriers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`adapter` text NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`config` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `carriers_slug_unique` ON `carriers` (`slug`);--> statement-breakpoint
CREATE TABLE `carts` (
	`id` text PRIMARY KEY NOT NULL,
	`items` text NOT NULL,
	`phone` text,
	`name` text,
	`wilaya_code` integer,
	`value` integer DEFAULT 0 NOT NULL,
	`step` text,
	`consent` integer DEFAULT false NOT NULL,
	`recovered_order_id` integer,
	`last_contacted_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `carts_updated_idx` ON `carts` (`updated_at`);--> statement-breakpoint
CREATE TABLE `categories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`parent_id` integer,
	`slug` text NOT NULL,
	`name_fr` text NOT NULL,
	`name_ar` text NOT NULL,
	`description_fr` text,
	`description_ar` text,
	`image` text,
	`sort` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`seo_title` text,
	`seo_description` text,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `categories_slug_unique` ON `categories` (`slug`);--> statement-breakpoint
CREATE TABLE `collection_products` (
	`collection_id` integer NOT NULL,
	`product_id` integer NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`collection_id`, `product_id`),
	FOREIGN KEY (`collection_id`) REFERENCES `collections`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `collections` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`name_fr` text NOT NULL,
	`name_ar` text NOT NULL,
	`rule` text,
	`is_active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `collections_slug_unique` ON `collections` (`slug`);--> statement-breakpoint
CREATE TABLE `communes` (
	`id` integer PRIMARY KEY NOT NULL,
	`wilaya_code` integer NOT NULL,
	`name_fr` text NOT NULL,
	`name_ar` text NOT NULL,
	`daira_fr` text,
	`daira_ar` text,
	`home_supported` integer DEFAULT true NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`wilaya_code`) REFERENCES `wilayas`(`code`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `communes_wilaya_idx` ON `communes` (`wilaya_code`);--> statement-breakpoint
CREATE TABLE `contact_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`phone` text,
	`subject` text,
	`message` text NOT NULL,
	`status` text DEFAULT 'new' NOT NULL,
	`handled_by` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `coupons` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`type` text NOT NULL,
	`value` integer DEFAULT 0 NOT NULL,
	`min_subtotal` integer,
	`applies_to` text,
	`wilaya_codes` text,
	`first_order_only` integer DEFAULT false NOT NULL,
	`per_customer_limit` integer,
	`usage_limit` integer,
	`used_count` integer DEFAULT 0 NOT NULL,
	`starts_at` integer,
	`ends_at` integer,
	`is_active` integer DEFAULT true NOT NULL,
	`influencer_name` text,
	`commission_pct` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT "coupons_usage_ok" CHECK("coupons"."usage_limit" IS NULL OR "coupons"."used_count" <= "coupons"."usage_limit")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `coupons_code_unique` ON `coupons` (`code`);--> statement-breakpoint
CREATE TABLE `customers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`phone` text NOT NULL,
	`name` text NOT NULL,
	`wilaya_code` integer,
	`commune_id` integer,
	`address` text,
	`tags` text DEFAULT '[]' NOT NULL,
	`notes` text,
	`is_blacklisted` integer DEFAULT false NOT NULL,
	`blacklist_reason` text,
	`orders_count` integer DEFAULT 0 NOT NULL,
	`delivered_count` integer DEFAULT 0 NOT NULL,
	`returned_count` integer DEFAULT 0 NOT NULL,
	`cancelled_count` integer DEFAULT 0 NOT NULL,
	`total_spent` integer DEFAULT 0 NOT NULL,
	`points_balance` integer DEFAULT 0 NOT NULL,
	`tier` text,
	`referral_code` text,
	`referred_by` integer,
	`first_order_at` integer,
	`last_order_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `customers_phone_unique` ON `customers` (`phone`);--> statement-breakpoint
CREATE UNIQUE INDEX `customers_referral_code_unique` ON `customers` (`referral_code`);--> statement-breakpoint
CREATE TABLE `error_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`fingerprint` text NOT NULL,
	`source` text NOT NULL,
	`message` text NOT NULL,
	`stack` text,
	`url` text,
	`count` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`first_seen` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`last_seen` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `error_events_fingerprint_unique` ON `error_events` (`fingerprint`);--> statement-breakpoint
CREATE INDEX `error_status_idx` ON `error_events` (`status`,`last_seen`);--> statement-breakpoint
CREATE TABLE `home_blocks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`type` text NOT NULL,
	`config` text NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	`starts_at` integer,
	`ends_at` integer,
	`is_active` integer DEFAULT true NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `links` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`slug` text,
	`label_fr` text,
	`label_ar` text,
	`target` text NOT NULL,
	`icon` text,
	`sort` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`clicks` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `links_slug_unique` ON `links` (`slug`);--> statement-breakpoint
CREATE TABLE `loyalty_ledger` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`customer_id` integer NOT NULL,
	`delta` integer NOT NULL,
	`reason` text NOT NULL,
	`order_id` integer,
	`actor` text NOT NULL,
	`note` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `loyalty_customer_idx` ON `loyalty_ledger` (`customer_id`);--> statement-breakpoint
CREATE TABLE `message_templates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`channel` text NOT NULL,
	`body_fr` text NOT NULL,
	`body_ar` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `message_templates_key_unique` ON `message_templates` (`key`);--> statement-breakpoint
CREATE TABLE `not_found_log` (
	`path` text PRIMARY KEY NOT NULL,
	`count` integer DEFAULT 1 NOT NULL,
	`referrer` text,
	`last_seen` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `option_values` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`option_id` integer NOT NULL,
	`label_fr` text NOT NULL,
	`label_ar` text NOT NULL,
	`hex` text,
	`sort` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`option_id`) REFERENCES `product_options`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `order_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`order_id` integer NOT NULL,
	`from_status` text,
	`to_status` text,
	`kind` text DEFAULT 'status' NOT NULL,
	`actor` text NOT NULL,
	`source` text NOT NULL,
	`note` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `order_events_order_idx` ON `order_events` (`order_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `order_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`order_id` integer NOT NULL,
	`variant_id` integer,
	`product_id` integer,
	`name_fr` text NOT NULL,
	`name_ar` text NOT NULL,
	`sku` text NOT NULL,
	`options_label` text,
	`image` text,
	`unit_price` integer NOT NULL,
	`qty` integer NOT NULL,
	`line_discount` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`variant_id`) REFERENCES `variants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `order_items_order_idx` ON `order_items` (`order_id`);--> statement-breakpoint
CREATE TABLE `orders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`public_code` text NOT NULL,
	`track_token_hash` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`status` text DEFAULT 'nouvelle' NOT NULL,
	`channel` text DEFAULT 'web' NOT NULL,
	`locale` text DEFAULT 'fr' NOT NULL,
	`customer_id` integer NOT NULL,
	`name` text NOT NULL,
	`phone` text NOT NULL,
	`wilaya_code` integer NOT NULL,
	`commune_id` integer,
	`commune_text` text,
	`delivery_type` text NOT NULL,
	`stop_desk_id` integer,
	`address` text,
	`subtotal` integer NOT NULL,
	`discount_total` integer DEFAULT 0 NOT NULL,
	`shipping_price` integer NOT NULL,
	`total` integer NOT NULL,
	`coupon_code` text,
	`points_used` integer DEFAULT 0 NOT NULL,
	`points_earned` integer DEFAULT 0 NOT NULL,
	`payment_method` text DEFAULT 'cod' NOT NULL,
	`payment_status` text DEFAULT 'pending' NOT NULL,
	`carrier_id` integer,
	`tracking_number` text,
	`carrier_status` text,
	`label_url` text,
	`assigned_to` integer,
	`confirm_attempts` integer DEFAULT 0 NOT NULL,
	`next_callback_at` integer,
	`customer_note` text,
	`internal_note` text,
	`risk_score` integer DEFAULT 0 NOT NULL,
	`telegram_message_id` integer,
	`op_nonce` text,
	`utm_source` text,
	`utm_medium` text,
	`utm_campaign` text,
	`referrer` text,
	`ip_hash` text,
	`ua_short` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`confirmed_at` integer,
	`shipped_at` integer,
	`delivered_at` integer,
	`returned_at` integer,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `orders_public_code_unique` ON `orders` (`public_code`);--> statement-breakpoint
CREATE UNIQUE INDEX `orders_idempotency_key_unique` ON `orders` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `orders_status_created_idx` ON `orders` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `orders_customer_idx` ON `orders` (`customer_id`);--> statement-breakpoint
CREATE INDEX `orders_phone_idx` ON `orders` (`phone`);--> statement-breakpoint
CREATE INDEX `orders_tracking_idx` ON `orders` (`tracking_number`);--> statement-breakpoint
CREATE INDEX `orders_callback_idx` ON `orders` (`next_callback_at`);--> statement-breakpoint
CREATE TABLE `outbox` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`payload` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`last_error` text,
	`done_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `outbox_pending_idx` ON `outbox` (`done_at`,`next_attempt_at`);--> statement-breakpoint
CREATE TABLE `pages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`title_fr` text NOT NULL,
	`title_ar` text NOT NULL,
	`body_fr` text DEFAULT '' NOT NULL,
	`body_ar` text DEFAULT '' NOT NULL,
	`seo_description` text,
	`is_active` integer DEFAULT true NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pages_slug_unique` ON `pages` (`slug`);--> statement-breakpoint
CREATE TABLE `product_images` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`product_id` integer NOT NULL,
	`option_value_id` integer,
	`base_key` text NOT NULL,
	`widths` text NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`lqip` text,
	`alt_fr` text,
	`alt_ar` text,
	`sort` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `product_images_product_idx` ON `product_images` (`product_id`);--> statement-breakpoint
CREATE TABLE `product_options` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`product_id` integer NOT NULL,
	`kind` text NOT NULL,
	`name_fr` text NOT NULL,
	`name_ar` text NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `products` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`name_fr` text NOT NULL,
	`name_ar` text NOT NULL,
	`description_fr` text,
	`description_ar` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`publish_at` integer,
	`category_id` integer,
	`tags` text DEFAULT '[]' NOT NULL,
	`price` integer NOT NULL,
	`compare_at_price` integer,
	`cost_price` integer,
	`size_guide_id` integer,
	`video_key` text,
	`instagram_url` text,
	`seo_title` text,
	`seo_description` text,
	`sort` integer DEFAULT 0 NOT NULL,
	`created_by` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`size_guide_id`) REFERENCES `size_guides`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `products_slug_unique` ON `products` (`slug`);--> statement-breakpoint
CREATE INDEX `products_status_cat_idx` ON `products` (`status`,`category_id`);--> statement-breakpoint
CREATE TABLE `promotions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`config` text NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`stackable` integer DEFAULT false NOT NULL,
	`starts_at` integer,
	`ends_at` integer,
	`is_active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE `push_subscriptions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`endpoint` text NOT NULL,
	`p256dh` text NOT NULL,
	`auth` text NOT NULL,
	`locale` text DEFAULT 'fr' NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `push_subscriptions_endpoint_unique` ON `push_subscriptions` (`endpoint`);--> statement-breakpoint
CREATE TABLE `rate_hits` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `redirects` (
	`from` text PRIMARY KEY NOT NULL,
	`to` text NOT NULL,
	`code` integer DEFAULT 301 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `reviews` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`product_id` integer NOT NULL,
	`order_id` integer,
	`name` text NOT NULL,
	`rating` integer NOT NULL,
	`text` text,
	`photos` text,
	`verified` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`reply` text,
	`is_featured` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `reviews_product_status_idx` ON `reviews` (`product_id`,`status`);--> statement-breakpoint
CREATE TABLE `roles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`permissions` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `roles_key_unique` ON `roles` (`key`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `size_guides` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`table` text NOT NULL,
	`tips_fr` text,
	`tips_ar` text
);
--> statement-breakpoint
CREATE TABLE `stock_alerts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`variant_id` integer NOT NULL,
	`phone` text,
	`push_subscription_id` integer,
	`notified_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`variant_id`) REFERENCES `variants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `stock_alerts_variant_idx` ON `stock_alerts` (`variant_id`,`notified_at`);--> statement-breakpoint
CREATE TABLE `stock_movements` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`variant_id` integer NOT NULL,
	`delta` integer NOT NULL,
	`reason` text NOT NULL,
	`order_id` integer,
	`note` text,
	`actor` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`variant_id`) REFERENCES `variants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `stock_movements_variant_idx` ON `stock_movements` (`variant_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `stop_desks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`carrier_id` integer NOT NULL,
	`external_id` text,
	`wilaya_code` integer NOT NULL,
	`commune_id` integer,
	`name` text NOT NULL,
	`address` text,
	`phone` text,
	`lat` real,
	`lng` real,
	`is_active` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`carrier_id`) REFERENCES `carriers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`wilaya_code`) REFERENCES `wilayas`(`code`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`commune_id`) REFERENCES `communes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `stop_desks_wilaya_idx` ON `stop_desks` (`wilaya_code`);--> statement-breakpoint
CREATE TABLE `team_members` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`role_id` integer NOT NULL,
	`telegram_user_id` integer,
	`phone` text,
	`is_active` integer DEFAULT true NOT NULL,
	`password_hash` text,
	`password_salt` text,
	`email_verified_at` integer,
	`failed_logins` integer DEFAULT 0 NOT NULL,
	`locked_until` integer,
	`last_seen_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `team_members_email_unique` ON `team_members` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `team_members_telegram_user_id_unique` ON `team_members` (`telegram_user_id`);--> statement-breakpoint
CREATE TABLE `variants` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`product_id` integer NOT NULL,
	`sku` text NOT NULL,
	`barcode` text,
	`option_value_ids` text NOT NULL,
	`price_override` integer,
	`stock_on_hand` integer DEFAULT 0 NOT NULL,
	`stock_reserved` integer DEFAULT 0 NOT NULL,
	`low_stock_threshold` integer DEFAULT 2 NOT NULL,
	`weight_g` integer,
	`is_active` integer DEFAULT true NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "variants_stock_ok" CHECK("variants"."stock_on_hand" >= 0 AND "variants"."stock_reserved" >= 0 AND "variants"."stock_reserved" <= "variants"."stock_on_hand")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `variants_sku_unique` ON `variants` (`sku`);--> statement-breakpoint
CREATE INDEX `variants_product_idx` ON `variants` (`product_id`);--> statement-breakpoint
CREATE TABLE `wilayas` (
	`code` integer PRIMARY KEY NOT NULL,
	`name_fr` text NOT NULL,
	`name_ar` text NOT NULL,
	`parent_code` integer,
	`is_active` integer DEFAULT true NOT NULL,
	`home_price` integer,
	`desk_price` integer,
	`delay_days` text,
	`sort` integer DEFAULT 0 NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
