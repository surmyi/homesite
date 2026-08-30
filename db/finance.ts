import { env } from 'cloudflare:workers';

export const DEFAULT_PORTFOLIO_ID = 'personal';

export const INITIAL_FINANCE_CATEGORIES = [
  { id: 'cash', displayName: 'Cash', summaryGroup: 'cash', balanceKind: 'asset', sortOrder: 10 },
  { id: 'brokerage', displayName: 'Brokerage', summaryGroup: 'investment', balanceKind: 'asset', sortOrder: 20 },
  { id: '401k', displayName: '401(k)', summaryGroup: 'retirements', balanceKind: 'asset', sortOrder: 30 },
  { id: 'ira', displayName: 'IRA', summaryGroup: 'retirements', balanceKind: 'asset', sortOrder: 40 },
  { id: 'roth_ira', displayName: 'Roth IRA', summaryGroup: 'retirements', balanceKind: 'asset', sortOrder: 50 },
  { id: 'benefit', displayName: 'Benefit', summaryGroup: 'benefit', balanceKind: 'asset', sortOrder: 60 },
  { id: 'mortgage', displayName: 'Mortgage', summaryGroup: 'mortgage', balanceKind: 'debt', sortOrder: 70 },
  { id: 'credit_card', displayName: 'Credit Card', summaryGroup: 'credit_cards', balanceKind: 'debt', sortOrder: 80 },
  { id: 'other_asset', displayName: 'Other Asset', summaryGroup: 'other_assets', balanceKind: 'asset', sortOrder: 90 },
] as const;

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS finance_portfolios (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    currency TEXT NOT NULL DEFAULT 'USD',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS finance_categories (
    id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    summary_group TEXT NOT NULL,
    balance_kind TEXT NOT NULL CHECK (balance_kind IN ('asset', 'debt')),
    sort_order INTEGER NOT NULL DEFAULT 100,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS finance_institutions (
    id TEXT PRIMARY KEY,
    normalized_name TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS finance_accounts (
    id TEXT PRIMARY KEY,
    portfolio_id TEXT NOT NULL,
    institution_id TEXT NOT NULL,
    canonical_key TEXT NOT NULL,
    display_name TEXT NOT NULL,
    last_four TEXT,
    source_type TEXT NOT NULL,
    default_category_id TEXT NOT NULL,
    category_override_id TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'deleted')),
    metadata_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (portfolio_id) REFERENCES finance_portfolios(id),
    FOREIGN KEY (institution_id) REFERENCES finance_institutions(id),
    FOREIGN KEY (default_category_id) REFERENCES finance_categories(id),
    FOREIGN KEY (category_override_id) REFERENCES finance_categories(id),
    UNIQUE (portfolio_id, canonical_key)
  )`,
  `CREATE TABLE IF NOT EXISTS finance_account_identifiers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id TEXT NOT NULL,
    scheme TEXT NOT NULL,
    value TEXT NOT NULL,
    is_primary INTEGER NOT NULL DEFAULT 0,
    valid_from TEXT,
    valid_to TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (account_id) REFERENCES finance_accounts(id),
    UNIQUE (scheme, value, account_id)
  )`,
  `CREATE TABLE IF NOT EXISTS finance_snapshots (
    id TEXT PRIMARY KEY,
    portfolio_id TEXT NOT NULL,
    report_date TEXT NOT NULL,
    source TEXT NOT NULL,
    source_ref TEXT,
    source_hash TEXT NOT NULL UNIQUE,
    raw_json TEXT NOT NULL,
    is_current INTEGER NOT NULL DEFAULT 1,
    warning_json TEXT,
    ingested_at TEXT NOT NULL,
    FOREIGN KEY (portfolio_id) REFERENCES finance_portfolios(id)
  )`,
  `CREATE TABLE IF NOT EXISTS finance_observations (
    snapshot_id TEXT NOT NULL,
    account_id TEXT NOT NULL,
    category_id TEXT NOT NULL,
    balance_cents INTEGER,
    ok INTEGER NOT NULL,
    error_type TEXT,
    reported_institution TEXT NOT NULL,
    reported_account TEXT NOT NULL,
    reported_type TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (snapshot_id, account_id),
    FOREIGN KEY (snapshot_id) REFERENCES finance_snapshots(id),
    FOREIGN KEY (account_id) REFERENCES finance_accounts(id),
    FOREIGN KEY (category_id) REFERENCES finance_categories(id)
  )`,
  `CREATE TABLE IF NOT EXISTS finance_observation_overrides (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    portfolio_id TEXT NOT NULL,
    report_date TEXT NOT NULL,
    account_id TEXT NOT NULL,
    operation TEXT NOT NULL DEFAULT 'upsert' CHECK (operation IN ('upsert', 'delete')),
    balance_cents INTEGER,
    ok INTEGER,
    error_type TEXT,
    category_id TEXT,
    note TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (portfolio_id) REFERENCES finance_portfolios(id),
    FOREIGN KEY (account_id) REFERENCES finance_accounts(id),
    FOREIGN KEY (category_id) REFERENCES finance_categories(id),
    UNIQUE (portfolio_id, report_date, account_id)
  )`,
  `CREATE TABLE IF NOT EXISTS finance_audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    portfolio_id TEXT NOT NULL,
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    before_json TEXT,
    after_json TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (portfolio_id) REFERENCES finance_portfolios(id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_finance_accounts_portfolio_category
   ON finance_accounts (portfolio_id, default_category_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_finance_account_identifiers_lookup
   ON finance_account_identifiers (scheme, value, valid_to)`,
  `CREATE INDEX IF NOT EXISTS idx_finance_snapshots_portfolio_date
   ON finance_snapshots (portfolio_id, report_date, is_current)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_snapshots_current_date
   ON finance_snapshots (portfolio_id, report_date) WHERE is_current = 1`,
  `CREATE INDEX IF NOT EXISTS idx_finance_observations_account
   ON finance_observations (account_id, snapshot_id)`,
  `CREATE INDEX IF NOT EXISTS idx_finance_overrides_date
   ON finance_observation_overrides (portfolio_id, report_date)`,
  `CREATE INDEX IF NOT EXISTS idx_finance_audit_entity
   ON finance_audit_log (portfolio_id, entity_type, entity_id, created_at)`,
];

export function getFinanceDb() {
  if (!env.DB) throw new Error('Cloudflare D1 binding `DB` is unavailable.');
  return env.DB;
}

export async function ensureFinanceSchema() {
  const db = getFinanceDb();
  await db.batch(schemaStatements.map((statement) => db.prepare(statement)));

  const now = new Date().toISOString();
  const seedStatements = [
    db.prepare(
      `INSERT OR IGNORE INTO finance_portfolios (id, name, currency, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).bind(DEFAULT_PORTFOLIO_ID, 'Personal', 'USD', now, now),
    ...INITIAL_FINANCE_CATEGORIES.map((category) => db.prepare(
      `INSERT OR IGNORE INTO finance_categories
       (id, display_name, summary_group, balance_kind, sort_order, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
    ).bind(
      category.id,
      category.displayName,
      category.summaryGroup,
      category.balanceKind,
      category.sortOrder,
      now,
      now,
    )),
  ];
  await db.batch(seedStatements);
  return db;
}
