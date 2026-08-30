CREATE TABLE `finance_account_identifiers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` text NOT NULL,
	`scheme` text NOT NULL,
	`value` text NOT NULL,
	`is_primary` integer DEFAULT false NOT NULL,
	`valid_from` text,
	`valid_to` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `finance_accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finance_account_identifiers_unique` ON `finance_account_identifiers` (`scheme`,`value`,`account_id`);--> statement-breakpoint
CREATE INDEX `idx_finance_account_identifiers_lookup` ON `finance_account_identifiers` (`scheme`,`value`,`valid_to`);--> statement-breakpoint
CREATE TABLE `finance_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`portfolio_id` text NOT NULL,
	`institution_id` text NOT NULL,
	`canonical_key` text NOT NULL,
	`display_name` text NOT NULL,
	`last_four` text,
	`source_type` text NOT NULL,
	`default_category_id` text NOT NULL,
	`category_override_id` text,
	`status` text DEFAULT 'active' NOT NULL,
	`metadata_json` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`portfolio_id`) REFERENCES `finance_portfolios`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`institution_id`) REFERENCES `finance_institutions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`default_category_id`) REFERENCES `finance_categories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`category_override_id`) REFERENCES `finance_categories`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "finance_accounts_status_check" CHECK("finance_accounts"."status" IN ('active', 'inactive', 'deleted'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finance_accounts_portfolio_canonical_unique` ON `finance_accounts` (`portfolio_id`,`canonical_key`);--> statement-breakpoint
CREATE INDEX `idx_finance_accounts_portfolio_category` ON `finance_accounts` (`portfolio_id`,`default_category_id`,`status`);--> statement-breakpoint
CREATE TABLE `finance_audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`portfolio_id` text NOT NULL,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`before_json` text,
	`after_json` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`portfolio_id`) REFERENCES `finance_portfolios`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_finance_audit_entity` ON `finance_audit_log` (`portfolio_id`,`entity_type`,`entity_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `finance_categories` (
	`id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`summary_group` text NOT NULL,
	`balance_kind` text NOT NULL,
	`sort_order` integer DEFAULT 100 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "finance_categories_balance_kind_check" CHECK("finance_categories"."balance_kind" IN ('asset', 'debt'))
);
--> statement-breakpoint
CREATE TABLE `finance_institutions` (
	`id` text PRIMARY KEY NOT NULL,
	`normalized_name` text NOT NULL,
	`display_name` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finance_institutions_normalized_name_unique` ON `finance_institutions` (`normalized_name`);--> statement-breakpoint
CREATE TABLE `finance_observation_overrides` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`portfolio_id` text NOT NULL,
	`report_date` text NOT NULL,
	`account_id` text NOT NULL,
	`operation` text DEFAULT 'upsert' NOT NULL,
	`balance_cents` integer,
	`ok` integer,
	`error_type` text,
	`category_id` text,
	`note` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`portfolio_id`) REFERENCES `finance_portfolios`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `finance_accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`category_id`) REFERENCES `finance_categories`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "finance_observation_overrides_operation_check" CHECK("finance_observation_overrides"."operation" IN ('upsert', 'delete'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finance_observation_overrides_unique` ON `finance_observation_overrides` (`portfolio_id`,`report_date`,`account_id`);--> statement-breakpoint
CREATE INDEX `idx_finance_overrides_date` ON `finance_observation_overrides` (`portfolio_id`,`report_date`);--> statement-breakpoint
CREATE TABLE `finance_observations` (
	`snapshot_id` text NOT NULL,
	`account_id` text NOT NULL,
	`category_id` text NOT NULL,
	`balance_cents` integer,
	`ok` integer NOT NULL,
	`error_type` text,
	`reported_institution` text NOT NULL,
	`reported_account` text NOT NULL,
	`reported_type` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`snapshot_id`, `account_id`),
	FOREIGN KEY (`snapshot_id`) REFERENCES `finance_snapshots`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `finance_accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`category_id`) REFERENCES `finance_categories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_finance_observations_account` ON `finance_observations` (`account_id`,`snapshot_id`);--> statement-breakpoint
CREATE TABLE `finance_portfolios` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `finance_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`portfolio_id` text NOT NULL,
	`report_date` text NOT NULL,
	`source` text NOT NULL,
	`source_ref` text,
	`source_hash` text NOT NULL,
	`raw_json` text NOT NULL,
	`is_current` integer DEFAULT true NOT NULL,
	`warning_json` text,
	`ingested_at` text NOT NULL,
	FOREIGN KEY (`portfolio_id`) REFERENCES `finance_portfolios`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finance_snapshots_source_hash_unique` ON `finance_snapshots` (`source_hash`);--> statement-breakpoint
CREATE INDEX `idx_finance_snapshots_portfolio_date` ON `finance_snapshots` (`portfolio_id`,`report_date`,`is_current`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_finance_snapshots_current_date` ON `finance_snapshots` (`portfolio_id`,`report_date`) WHERE "finance_snapshots"."is_current" = 1;