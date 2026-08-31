CREATE TABLE `site_access_audit` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`actor_user_id` text,
	`action` text NOT NULL,
	`target_user_id` text NOT NULL,
	`before_json` text,
	`after_json` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_site_access_audit_target` ON `site_access_audit` (`target_user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `site_access_users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`normalized_email` text NOT NULL,
	`display_name` text,
	`role` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`last_login_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`created_by` text NOT NULL,
	CONSTRAINT "site_access_users_role_check" CHECK("site_access_users"."role" IN ('admin', 'viewer')),
	CONSTRAINT "site_access_users_status_check" CHECK("site_access_users"."status" IN ('active', 'disabled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `site_access_users_normalized_email_unique` ON `site_access_users` (`normalized_email`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_site_access_users_email` ON `site_access_users` (`email`);--> statement-breakpoint
CREATE TABLE `site_auth_meta` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `site_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`access_user_id` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`revoked_at` text,
	FOREIGN KEY (`access_user_id`) REFERENCES `site_access_users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_site_sessions_user` ON `site_sessions` (`access_user_id`,`expires_at`);--> statement-breakpoint
CREATE TABLE `site_user_identities` (
	`provider` text NOT NULL,
	`subject` text NOT NULL,
	`access_user_id` text NOT NULL,
	`email_at_link` text NOT NULL,
	`linked_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	PRIMARY KEY(`provider`, `subject`),
	FOREIGN KEY (`access_user_id`) REFERENCES `site_access_users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_site_user_identity_per_provider` ON `site_user_identities` (`provider`,`access_user_id`);--> statement-breakpoint
INSERT INTO `site_access_users`
  (`id`, `email`, `normalized_email`, `display_name`, `role`, `status`, `created_at`, `updated_at`, `created_by`)
VALUES
  ('usr_bootstrap_hi_tianyiwu', 'hi.tianyiwu@gmail.com', 'hi.tianyiwu@gmail.com', 'Tianyi Wu', 'admin', 'active', datetime('now'), datetime('now'), 'bootstrap');--> statement-breakpoint
INSERT INTO `site_access_users`
  (`id`, `email`, `normalized_email`, `display_name`, `role`, `status`, `created_at`, `updated_at`, `created_by`)
VALUES
  ('usr_bootstrap_sites_owner', 'tianyiwu.95@gmail.com', 'tianyiwu.95@gmail.com', 'Tianyi Wu', 'admin', 'active', datetime('now'), datetime('now'), 'bootstrap');--> statement-breakpoint
INSERT INTO `site_auth_meta` (`key`, `value`)
VALUES ('bootstrap_admin_v1', datetime('now'));
