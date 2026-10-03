CREATE TABLE `experiment_stats` (
	`experiment_id` integer NOT NULL,
	`variant` text NOT NULL,
	`event` text NOT NULL,
	`day` text NOT NULL,
	`n` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`experiment_id`, `variant`, `event`, `day`),
	FOREIGN KEY (`experiment_id`) REFERENCES `experiments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `experiments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`config` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`winner` text,
	`started_at` integer,
	`ended_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
ALTER TABLE `orders` ADD `verified_at` integer;--> statement-breakpoint
ALTER TABLE `orders` ADD `packed_at` integer;--> statement-breakpoint
ALTER TABLE `orders` ADD `pack_photo` text;