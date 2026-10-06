ALTER TABLE `auth_challenges` ADD `pending_totp` text;--> statement-breakpoint
ALTER TABLE `team_members` ADD `totp_secret_enc` text;--> statement-breakpoint
ALTER TABLE `team_members` ADD `totp_last_step` integer;