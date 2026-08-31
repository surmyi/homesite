UPDATE `site_access_users`
SET `role` = 'admin',
    `status` = 'active',
    `updated_at` = datetime('now')
WHERE `id` = 'usr_bootstrap_sites_owner';--> statement-breakpoint
INSERT OR IGNORE INTO `site_auth_meta` (`key`, `value`)
VALUES ('self_lockout_repair_v1', datetime('now'));
