import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

export const preferences = sqliteTable('preferences', {
  id: integer('id').primaryKey(),
  citiesJson: text('cities_json').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const siteAuthMeta = sqliteTable('site_auth_meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

export const siteAccessUsers = sqliteTable(
  'site_access_users',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull(),
    normalizedEmail: text('normalized_email').notNull().unique(),
    displayName: text('display_name'),
    role: text('role', { enum: ['admin', 'viewer'] }).notNull(),
    status: text('status', { enum: ['active', 'disabled'] })
      .notNull()
      .default('active'),
    lastLoginAt: text('last_login_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    createdBy: text('created_by').notNull(),
  },
  (table) => [
    uniqueIndex('idx_site_access_users_email').on(table.email),
    check(
      'site_access_users_role_check',
      sql`${table.role} IN ('admin', 'viewer')`,
    ),
    check(
      'site_access_users_status_check',
      sql`${table.status} IN ('active', 'disabled')`,
    ),
  ],
);

export const siteUserIdentities = sqliteTable(
  'site_user_identities',
  {
    provider: text('provider').notNull(),
    subject: text('subject').notNull(),
    accessUserId: text('access_user_id')
      .notNull()
      .references(() => siteAccessUsers.id, { onDelete: 'cascade' }),
    emailAtLink: text('email_at_link').notNull(),
    linkedAt: text('linked_at').notNull(),
    lastSeenAt: text('last_seen_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.provider, table.subject] }),
    uniqueIndex('idx_site_user_identity_per_provider').on(
      table.provider,
      table.accessUserId,
    ),
  ],
);

export const siteSessions = sqliteTable(
  'site_sessions',
  {
    tokenHash: text('token_hash').primaryKey(),
    accessUserId: text('access_user_id')
      .notNull()
      .references(() => siteAccessUsers.id, { onDelete: 'cascade' }),
    createdAt: text('created_at').notNull(),
    expiresAt: text('expires_at').notNull(),
    revokedAt: text('revoked_at'),
  },
  (table) => [
    index('idx_site_sessions_user').on(table.accessUserId, table.expiresAt),
  ],
);

export const siteAccessAudit = sqliteTable(
  'site_access_audit',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    actorUserId: text('actor_user_id'),
    action: text('action').notNull(),
    targetUserId: text('target_user_id').notNull(),
    beforeJson: text('before_json'),
    afterJson: text('after_json'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('idx_site_access_audit_target').on(
      table.targetUserId,
      table.createdAt,
    ),
  ],
);

export const financePortfolios = sqliteTable('finance_portfolios', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  currency: text('currency').notNull().default('USD'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const financeCategories = sqliteTable(
  'finance_categories',
  {
    id: text('id').primaryKey(),
    displayName: text('display_name').notNull(),
    summaryGroup: text('summary_group').notNull(),
    balanceKind: text('balance_kind', { enum: ['asset', 'debt'] }).notNull(),
    sortOrder: integer('sort_order').notNull().default(100),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    check(
      'finance_categories_balance_kind_check',
      sql`${table.balanceKind} IN ('asset', 'debt')`,
    ),
  ],
);

export const financeInstitutions = sqliteTable('finance_institutions', {
  id: text('id').primaryKey(),
  normalizedName: text('normalized_name').notNull().unique(),
  displayName: text('display_name').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const financeAccounts = sqliteTable(
  'finance_accounts',
  {
    id: text('id').primaryKey(),
    portfolioId: text('portfolio_id')
      .notNull()
      .references(() => financePortfolios.id),
    institutionId: text('institution_id')
      .notNull()
      .references(() => financeInstitutions.id),
    canonicalKey: text('canonical_key').notNull(),
    displayName: text('display_name').notNull(),
    lastFour: text('last_four'),
    sourceType: text('source_type').notNull(),
    defaultCategoryId: text('default_category_id')
      .notNull()
      .references(() => financeCategories.id),
    categoryOverrideId: text('category_override_id').references(
      () => financeCategories.id,
    ),
    status: text('status', { enum: ['active', 'inactive', 'deleted'] })
      .notNull()
      .default('active'),
    metadataJson: text('metadata_json'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('finance_accounts_portfolio_canonical_unique').on(
      table.portfolioId,
      table.canonicalKey,
    ),
    index('idx_finance_accounts_portfolio_category').on(
      table.portfolioId,
      table.defaultCategoryId,
      table.status,
    ),
    check(
      'finance_accounts_status_check',
      sql`${table.status} IN ('active', 'inactive', 'deleted')`,
    ),
  ],
);

export const financeAccountIdentifiers = sqliteTable(
  'finance_account_identifiers',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    accountId: text('account_id')
      .notNull()
      .references(() => financeAccounts.id),
    scheme: text('scheme').notNull(),
    value: text('value').notNull(),
    isPrimary: integer('is_primary', { mode: 'boolean' })
      .notNull()
      .default(false),
    validFrom: text('valid_from'),
    validTo: text('valid_to'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('finance_account_identifiers_unique').on(
      table.scheme,
      table.value,
      table.accountId,
    ),
    index('idx_finance_account_identifiers_lookup').on(
      table.scheme,
      table.value,
      table.validTo,
    ),
  ],
);

export const financeSnapshots = sqliteTable(
  'finance_snapshots',
  {
    id: text('id').primaryKey(),
    portfolioId: text('portfolio_id')
      .notNull()
      .references(() => financePortfolios.id),
    reportDate: text('report_date').notNull(),
    source: text('source').notNull(),
    sourceRef: text('source_ref'),
    sourceHash: text('source_hash').notNull().unique(),
    rawJson: text('raw_json').notNull(),
    isCurrent: integer('is_current', { mode: 'boolean' })
      .notNull()
      .default(true),
    warningJson: text('warning_json'),
    ingestedAt: text('ingested_at').notNull(),
  },
  (table) => [
    index('idx_finance_snapshots_portfolio_date').on(
      table.portfolioId,
      table.reportDate,
      table.isCurrent,
    ),
    uniqueIndex('idx_finance_snapshots_current_date')
      .on(table.portfolioId, table.reportDate)
      .where(sql`${table.isCurrent} = 1`),
  ],
);

export const financeObservations = sqliteTable(
  'finance_observations',
  {
    snapshotId: text('snapshot_id')
      .notNull()
      .references(() => financeSnapshots.id),
    accountId: text('account_id')
      .notNull()
      .references(() => financeAccounts.id),
    categoryId: text('category_id')
      .notNull()
      .references(() => financeCategories.id),
    balanceCents: integer('balance_cents'),
    ok: integer('ok', { mode: 'boolean' }).notNull(),
    errorType: text('error_type'),
    reportedInstitution: text('reported_institution').notNull(),
    reportedAccount: text('reported_account').notNull(),
    reportedType: text('reported_type').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.snapshotId, table.accountId] }),
    index('idx_finance_observations_account').on(
      table.accountId,
      table.snapshotId,
    ),
  ],
);

export const financeObservationOverrides = sqliteTable(
  'finance_observation_overrides',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    portfolioId: text('portfolio_id')
      .notNull()
      .references(() => financePortfolios.id),
    reportDate: text('report_date').notNull(),
    accountId: text('account_id')
      .notNull()
      .references(() => financeAccounts.id),
    operation: text('operation', { enum: ['upsert', 'delete'] })
      .notNull()
      .default('upsert'),
    balanceCents: integer('balance_cents'),
    ok: integer('ok', { mode: 'boolean' }),
    errorType: text('error_type'),
    categoryId: text('category_id').references(() => financeCategories.id),
    note: text('note'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('finance_observation_overrides_unique').on(
      table.portfolioId,
      table.reportDate,
      table.accountId,
    ),
    index('idx_finance_overrides_date').on(table.portfolioId, table.reportDate),
    check(
      'finance_observation_overrides_operation_check',
      sql`${table.operation} IN ('upsert', 'delete')`,
    ),
  ],
);

export const financeAuditLog = sqliteTable(
  'finance_audit_log',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    portfolioId: text('portfolio_id')
      .notNull()
      .references(() => financePortfolios.id),
    actor: text('actor').notNull(),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    beforeJson: text('before_json'),
    afterJson: text('after_json'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('idx_finance_audit_entity').on(
      table.portfolioId,
      table.entityType,
      table.entityId,
      table.createdAt,
    ),
  ],
);
