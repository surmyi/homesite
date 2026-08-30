import { DEFAULT_PORTFOLIO_ID, ensureFinanceSchema } from '@/db/finance';

export const runtime = 'edge';

type IncomingAccount = {
  source_account_id?: string;
  institution: string;
  account: string;
  type: string;
  balance: number | null;
  ok: boolean;
  error_type: string | null;
};

type IncomingSnapshot = {
  report_date: string;
  accounts: IncomingAccount[];
};

type AccountRow = {
  id: string;
  canonical_key: string;
  display_name: string;
};

type DashboardAccount = {
  id: string;
  institution: string;
  account: string;
  lastFour: string | null;
  canonicalKey: string;
  categoryId: string;
  categoryOverrideId: string | null;
};

type ObservationRow = {
  report_date: string;
  account_id: string;
  category_id: string;
  balance_cents: number | null;
  ok: number;
  error_type: string | null;
};

type OverrideRow = {
  report_date: string;
  account_id: string;
  operation: 'upsert' | 'delete';
  balance_cents: number | null;
  ok: number | null;
  error_type: string | null;
  category_id: string | null;
};

const MAX_BODY_BYTES = 1_000_000;

function normalizeIdentity(value: string) {
  return value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function extractLastFour(value: string) {
  return value.match(/(?:[•*xX]{2,}|ending\s+in\s+)(\d{4})\b/i)?.[1]
    ?? value.match(/(?:^|\D)(\d{4})\s*$/)?.[1]
    ?? null;
}

function categoryFor(type: string) {
  const normalized = normalizeIdentity(type);
  if (normalized.includes('401')) return '401k';
  if (normalized.includes('roth') && normalized.includes('ira')) return 'roth_ira';
  if (normalized === 'ira' || normalized.includes('traditional ira')) return 'ira';
  if (normalized.includes('hsa') || normalized.includes('fsa') || normalized.includes('benefit')) return 'benefit';
  if (normalized.includes('mortgage')) return 'mortgage';
  if (normalized.includes('credit card') || normalized.includes('creditcard')) return 'credit_card';
  if (normalized.includes('brokerage') || normalized.includes('investment') || normalized.includes('rsu')) return 'brokerage';
  if (normalized.includes('cash') || normalized.includes('checking') || normalized.includes('saving')) return 'cash';
  if (normalized.includes('asset') || normalized.includes('crypto')) return 'other_asset';
  return null;
}

function slug(value: string) {
  return normalizeIdentity(value).replaceAll(' ', '_').slice(0, 48) || 'uncategorized';
}

function appearsSensitive(value: unknown, key = ''): boolean {
  if (/(?:authorization|password|passwd|secret|(?:access[_-]?)?token|api[_-]?key|account[_-]?(?:number|no)|routing[_-]?(?:number|no))/i.test(key)) {
    return true;
  }
  if (typeof value === 'string') {
    if (key !== 'account') return false;
    if (/\d{5,}/.test(value)) return true;
    return (value.match(/\d{4}/g) ?? []).length > 1;
  }
  if (Array.isArray(value)) return value.some((item) => appearsSensitive(item));
  if (value && typeof value === 'object') {
    return Object.entries(value).some(([childKey, childValue]) => appearsSensitive(childValue, childKey));
  }
  return false;
}

function safeBalanceCents(balance: number | null) {
  if (balance === null) return null;
  const cents = Math.round(balance * 100);
  return Number.isSafeInteger(cents) ? cents : null;
}

function validateSnapshot(value: unknown): value is IncomingSnapshot {
  if (!value || typeof value !== 'object') return false;
  const snapshot = value as Partial<IncomingSnapshot>;
  if (typeof snapshot.report_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(snapshot.report_date)) return false;
  const parsedDate = new Date(`${snapshot.report_date}T00:00:00Z`);
  if (Number.isNaN(parsedDate.valueOf()) || parsedDate.toISOString().slice(0, 10) !== snapshot.report_date) return false;
  if (!Array.isArray(snapshot.accounts) || snapshot.accounts.length < 1 || snapshot.accounts.length > 500) return false;
  return snapshot.accounts.every((account) => (
    account &&
    (account.source_account_id === undefined || (
      typeof account.source_account_id === 'string' && account.source_account_id.trim().length > 0 && account.source_account_id.length <= 180
    )) &&
    typeof account.institution === 'string' && account.institution.trim().length > 0 && account.institution.length <= 180 &&
    normalizeIdentity(account.institution).length > 0 &&
    typeof account.account === 'string' && account.account.trim().length > 0 && account.account.length <= 240 &&
    normalizeIdentity(account.account).length > 0 &&
    typeof account.type === 'string' && account.type.trim().length > 0 && account.type.length <= 120 &&
    normalizeIdentity(account.type).length > 0 &&
    (account.balance === null || (
      typeof account.balance === 'number' && Number.isFinite(account.balance) && safeBalanceCents(account.balance) !== null
    )) &&
    typeof account.ok === 'boolean' &&
    (account.error_type === null || (typeof account.error_type === 'string' && account.error_type.length <= 160))
  ));
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function ensureCategory(db: D1Database, sourceType: string, balance: number | null) {
  const known = categoryFor(sourceType);
  if (known) return known;

  const id = `custom_${slug(sourceType)}`;
  const now = new Date().toISOString();
  await db.prepare(
    `INSERT OR IGNORE INTO finance_categories
     (id, display_name, summary_group, balance_kind, sort_order, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, 500, 1, ?, ?)`,
  ).bind(id, sourceType.trim(), id, balance !== null && balance < 0 ? 'debt' : 'asset', now, now).run();
  return id;
}

async function ensureInstitution(db: D1Database, displayName: string) {
  const normalized = normalizeIdentity(displayName);
  const id = `inst_${(await sha256(normalized)).slice(0, 20)}`;
  const now = new Date().toISOString();
  await db.prepare(
    `INSERT INTO finance_institutions (id, normalized_name, display_name, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(normalized_name) DO UPDATE SET display_name = excluded.display_name, updated_at = excluded.updated_at`,
  ).bind(id, normalized, displayName.trim(), now, now).run();
  const row = await db.prepare(
    'SELECT id FROM finance_institutions WHERE normalized_name = ?',
  ).bind(normalized).first<{ id: string }>();
  if (!row) throw new Error('Institution could not be resolved');
  return { id: row.id, normalized };
}

class AccountResolutionError extends Error {}

async function ensureAccount(
  db: D1Database,
  incoming: IncomingAccount,
  categoryId: string,
  reportDate: string,
) {
  const institution = await ensureInstitution(db, incoming.institution);
  const lastFour = extractLastFour(incoming.account);
  const normalizedAccount = normalizeIdentity(incoming.account);
  const nameIdentifier = `${institution.normalized}|${normalizedAccount}`;
  const sourceIdentifier = incoming.source_account_id
    ? `${institution.normalized}|${incoming.source_account_id.trim()}`
    : null;
  const lastFourIdentifier = lastFour ? `${institution.normalized}|${lastFour}` : null;

  async function matchingAccounts(scheme: string, value: string) {
    return db.prepare(
      `SELECT a.id, a.canonical_key, a.display_name
       FROM finance_account_identifiers AS identifier
       JOIN finance_accounts AS a ON a.id = identifier.account_id
       WHERE identifier.scheme = ? AND identifier.value = ?
         AND (identifier.valid_from IS NULL OR identifier.valid_from <= ?)
         AND (identifier.valid_to IS NULL OR identifier.valid_to >= ?)
         AND a.portfolio_id = ? AND a.status != 'deleted'
       ORDER BY a.created_at`,
    ).bind(scheme, value, reportDate, reportDate, DEFAULT_PORTFOLIO_ID).all<AccountRow>();
  }

  let account: AccountRow | null = null;
  if (sourceIdentifier) {
    const sourceMatches = await matchingAccounts('source_account_id', sourceIdentifier);
    if (sourceMatches.results.length > 1) throw new AccountResolutionError('Source account identifier is ambiguous');
    account = sourceMatches.results[0] ?? null;
  }
  if (!account) {
    const nameMatches = await matchingAccounts('institution_account_name', nameIdentifier);
    if (nameMatches.results.length > 1) throw new AccountResolutionError('Institution and account name are ambiguous');
    account = nameMatches.results[0] ?? null;
  }
  if (!account && lastFourIdentifier) {
    const lastFourMatches = await matchingAccounts('institution_last4', lastFourIdentifier);
    if (lastFourMatches.results.length > 1) throw new AccountResolutionError('Institution and last four digits are ambiguous');
    account = lastFourMatches.results[0] ?? null;
  }

  const now = new Date().toISOString();
  if (!account) {
    const id = crypto.randomUUID();
    const canonicalBase = lastFour
      ? `${institution.normalized}:${lastFour}`
      : `${institution.normalized}:${normalizedAccount}`;
    const existing = await db.prepare(
      'SELECT 1 AS found FROM finance_accounts WHERE portfolio_id = ? AND canonical_key = ?',
    ).bind(DEFAULT_PORTFOLIO_ID, canonicalBase).first<{ found: number }>();
    const canonicalKey = existing ? `${canonicalBase}:${id.slice(0, 8)}` : canonicalBase;

    const identifiers = [
      sourceIdentifier ? { scheme: 'source_account_id', value: sourceIdentifier, primary: 1 } : null,
      lastFourIdentifier ? { scheme: 'institution_last4', value: lastFourIdentifier, primary: sourceIdentifier ? 0 : 1 } : null,
      { scheme: 'institution_account_name', value: nameIdentifier, primary: sourceIdentifier || lastFourIdentifier ? 0 : 1 },
    ].filter((identifier): identifier is { scheme: string; value: string; primary: number } => Boolean(identifier));
    await db.batch([
      db.prepare(
        `INSERT INTO finance_accounts
         (id, portfolio_id, institution_id, canonical_key, display_name, last_four, source_type,
          default_category_id, category_override_id, status, metadata_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 'active', NULL, ?, ?)`,
      ).bind(
        id,
        DEFAULT_PORTFOLIO_ID,
        institution.id,
        canonicalKey,
        incoming.account.trim(),
        lastFour,
        incoming.type.trim(),
        categoryId,
        now,
        now,
      ),
      ...identifiers.map((identifier) => db.prepare(
        `INSERT OR IGNORE INTO finance_account_identifiers
         (account_id, scheme, value, is_primary, valid_from, valid_to, created_at)
         VALUES (?, ?, ?, ?, ?, NULL, ?)`,
      ).bind(id, identifier.scheme, identifier.value, identifier.primary, reportDate, now)),
    ]);
    account = { id, canonical_key: canonicalKey, display_name: incoming.account.trim() };
  } else {
    const accountId = account.id;
    await db.batch([
      db.prepare(
        `UPDATE finance_accounts
         SET source_type = ?, default_category_id = ?, status = 'active', updated_at = ?
         WHERE id = ?`,
      ).bind(incoming.type.trim(), categoryId, now, accountId),
      ...[
        sourceIdentifier ? { scheme: 'source_account_id', value: sourceIdentifier } : null,
        lastFourIdentifier ? { scheme: 'institution_last4', value: lastFourIdentifier } : null,
        { scheme: 'institution_account_name', value: nameIdentifier },
      ].filter((identifier): identifier is { scheme: string; value: string } => Boolean(identifier)).map((identifier) => db.prepare(
        `INSERT OR IGNORE INTO finance_account_identifiers
         (account_id, scheme, value, is_primary, valid_from, valid_to, created_at)
         VALUES (?, ?, ?, 0, ?, NULL, ?)`,
      ).bind(accountId, identifier.scheme, identifier.value, reportDate, now)),
    ]);
  }

  if (!account) throw new Error('Account could not be resolved');
  return account.id;
}

function formatMoney(cents: number | null) {
  return cents === null ? null : Math.round(cents) / 100;
}

export async function POST(request: Request) {
  const rawJson = await request.text();
  if (new TextEncoder().encode(rawJson).byteLength > MAX_BODY_BYTES) {
    return Response.json({ error: 'Snapshot is too large' }, { status: 413 });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    return Response.json({ error: 'Snapshot must be valid JSON' }, { status: 400 });
  }
  if (!validateSnapshot(parsed)) {
    return Response.json({ error: 'Snapshot does not match the finance schema' }, { status: 400 });
  }
  if (appearsSensitive(parsed)) {
    return Response.json({ error: 'Snapshot appears to contain an unmasked identifier or secret field' }, { status: 400 });
  }

  const db = await ensureFinanceSchema();
  const sourceHash = await sha256(rawJson);
  const idempotencyKey = request.headers.get('idempotency-key');
  if (idempotencyKey && idempotencyKey !== sourceHash) {
    return Response.json({ error: 'Idempotency-Key must equal the SHA-256 hash of the request body' }, { status: 400 });
  }
  const existing = await db.prepare(
    'SELECT id, report_date FROM finance_snapshots WHERE source_hash = ?',
  ).bind(sourceHash).first<{ id: string; report_date: string }>();
  if (existing) {
    return Response.json({ ok: true, idempotent: true, snapshotId: existing.id, reportDate: existing.report_date });
  }

  const deduplicated = new Map<string, IncomingAccount>();
  for (const account of parsed.accounts) {
    const key = account.source_account_id
      ? `source|${normalizeIdentity(account.institution)}|${account.source_account_id.trim()}`
      : `${normalizeIdentity(account.institution)}|${extractLastFour(account.account) ?? normalizeIdentity(account.account)}`;
    if (deduplicated.has(key)) {
      return Response.json({ error: `Snapshot contains a duplicate account identity: ${key}` }, { status: 422 });
    }
    deduplicated.set(key, account);
  }

  const warnings: string[] = [];

  const resolved: Array<{ accountId: string; categoryId: string; incoming: IncomingAccount }> = [];
  try {
    for (const incoming of deduplicated.values()) {
      const categoryId = await ensureCategory(db, incoming.type, incoming.balance);
      const accountId = await ensureAccount(db, incoming, categoryId, parsed.report_date);
      resolved.push({ accountId, categoryId, incoming });
    }
  } catch (error) {
    if (error instanceof AccountResolutionError) {
      return Response.json({ error: error.message }, { status: 422 });
    }
    throw error;
  }

  const snapshotId = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.batch([
    db.prepare(
      `UPDATE finance_snapshots SET is_current = 0
       WHERE portfolio_id = ? AND report_date = ? AND is_current = 1`,
    ).bind(DEFAULT_PORTFOLIO_ID, parsed.report_date),
    db.prepare(
      `INSERT INTO finance_snapshots
       (id, portfolio_id, report_date, source, source_ref, source_hash, raw_json, is_current, warning_json, ingested_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    ).bind(
      snapshotId,
      DEFAULT_PORTFOLIO_ID,
      parsed.report_date,
      request.headers.get('x-finance-source')?.slice(0, 120) || 'auto-finance',
      request.headers.get('x-finance-source-ref')?.slice(0, 300) || null,
      sourceHash,
      rawJson,
      warnings.length ? JSON.stringify(warnings) : null,
      now,
    ),
    ...resolved.map(({ accountId, categoryId, incoming }) => db.prepare(
      `INSERT INTO finance_observations
       (snapshot_id, account_id, category_id, balance_cents, ok, error_type,
        reported_institution, reported_account, reported_type, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      snapshotId,
      accountId,
      categoryId,
      safeBalanceCents(incoming.balance),
      incoming.ok ? 1 : 0,
      incoming.error_type,
      incoming.institution.trim(),
      incoming.account.trim(),
      incoming.type.trim(),
      now,
    )),
    db.prepare(
      `INSERT INTO finance_audit_log
       (portfolio_id, actor, action, entity_type, entity_id, before_json, after_json, created_at)
       VALUES (?, 'automation', 'ingest', 'snapshot', ?, NULL, ?, ?)`,
    ).bind(
      DEFAULT_PORTFOLIO_ID,
      snapshotId,
      JSON.stringify({ reportDate: parsed.report_date, accountCount: resolved.length, sourceHash }),
      now,
    ),
  ]);

  return Response.json({
    ok: true,
    idempotent: false,
    snapshotId,
    reportDate: parsed.report_date,
    accountCount: resolved.length,
    warnings,
  }, { status: 201 });
}

export async function GET() {
  const db = await ensureFinanceSchema();
  const [snapshotsResult, categoriesResult, accountsResult, observationsResult, overridesResult] = await Promise.all([
    db.prepare(
      `SELECT id, report_date, ingested_at
       FROM finance_snapshots
       WHERE portfolio_id = ? AND is_current = 1
       ORDER BY report_date`,
    ).bind(DEFAULT_PORTFOLIO_ID).all<{ id: string; report_date: string; ingested_at: string }>(),
    db.prepare(
      `SELECT id, display_name, summary_group, balance_kind, sort_order
       FROM finance_categories WHERE is_active = 1 ORDER BY sort_order, display_name`,
    ).all<{ id: string; display_name: string; summary_group: string; balance_kind: string; sort_order: number }>(),
    db.prepare(
      `SELECT a.id, institution.display_name AS institution, a.display_name AS account,
              a.last_four, a.canonical_key,
              a.default_category_id AS category_id, a.category_override_id
       FROM finance_accounts AS a
       JOIN finance_institutions AS institution ON institution.id = a.institution_id
       WHERE a.portfolio_id = ? AND a.status != 'deleted'
       ORDER BY institution.display_name, a.display_name`,
    ).bind(DEFAULT_PORTFOLIO_ID).all<{
      id: string;
      institution: string;
      account: string;
      last_four: string | null;
      canonical_key: string;
      category_id: string;
      category_override_id: string | null;
    }>(),
    db.prepare(
      `SELECT snapshot.report_date, observation.account_id, observation.category_id,
              observation.balance_cents, observation.ok, observation.error_type
       FROM finance_observations AS observation
       JOIN finance_snapshots AS snapshot ON snapshot.id = observation.snapshot_id
       WHERE snapshot.portfolio_id = ? AND snapshot.is_current = 1
       ORDER BY snapshot.report_date`,
    ).bind(DEFAULT_PORTFOLIO_ID).all<ObservationRow>(),
    db.prepare(
      `SELECT report_date, account_id, operation, balance_cents, ok, error_type, category_id
       FROM finance_observation_overrides
       WHERE portfolio_id = ?
       ORDER BY report_date, account_id`,
    ).bind(DEFAULT_PORTFOLIO_ID).all<OverrideRow>(),
  ]);

  const accountById = new Map<string, DashboardAccount>();
  for (const row of accountsResult.results) {
    accountById.set(row.id, {
      id: row.id,
      institution: row.institution,
      account: row.account,
      lastFour: row.last_four,
      canonicalKey: row.canonical_key,
      categoryId: row.category_id,
      categoryOverrideId: row.category_override_id,
    });
  }

  const categoryById = new Map(categoriesResult.results.map((category) => [category.id, category]));
  const observations = new Map<string, ObservationRow>();
  for (const row of observationsResult.results) {
    observations.set(`${row.report_date}|${row.account_id}`, {
      ...row,
      category_id: accountById.get(row.account_id)?.categoryOverrideId ?? row.category_id,
    });
  }
  for (const override of overridesResult.results) {
    const key = `${override.report_date}|${override.account_id}`;
    if (override.operation === 'delete') {
      observations.delete(key);
      continue;
    }
    const source = observations.get(key);
    const fallbackCategory = accountById.get(override.account_id)?.categoryId;
    if (!source && !fallbackCategory && !override.category_id) continue;
    observations.set(key, {
      report_date: override.report_date,
      account_id: override.account_id,
      category_id: override.category_id ?? source?.category_id ?? fallbackCategory!,
      balance_cents: override.ok === 0 && override.balance_cents === null
        ? null
        : override.balance_cents ?? source?.balance_cents ?? null,
      ok: override.ok ?? source?.ok ?? (override.balance_cents === null ? 0 : 1),
      error_type: override.error_type ?? source?.error_type ?? null,
    });
  }

  const dates = Array.from(new Set([
    ...snapshotsResult.results.map((snapshot) => snapshot.report_date),
    ...overridesResult.results.map((override) => override.report_date),
  ])).sort();
  const observedAccountIds = new Set(Array.from(observations.values(), (row) => row.account_id));

  const categorySheets = categoriesResult.results
    .map((category) => {
      const categoryAccountIds = new Set(
        Array.from(observations.values())
          .filter((observation) => observation.category_id === category.id)
          .map((observation) => observation.account_id),
      );
      const accounts = Array.from(accountById.values()).filter((account) => categoryAccountIds.has(account.id));
      return {
        id: category.id,
        name: category.display_name,
        summaryGroup: category.summary_group,
        balanceKind: category.balance_kind,
        accounts,
        rows: dates.map((date) => ({
          date,
          values: Object.fromEntries(accounts.map((account) => {
            const candidate = observations.get(`${date}|${account.id}`);
            const value = candidate?.category_id === category.id ? candidate : null;
            return [account.id, value ? {
              balance: formatMoney(value.balance_cents),
              ok: Boolean(value.ok),
              errorType: value.error_type,
            } : null];
          })),
        })),
      };
    })
    .filter((category) => category.accounts.length > 0);

  const summaryGroups = Array.from(new Map(
    categorySheets.map((category) => [category.summaryGroup, category.summaryGroup]),
  ).keys());
  const preferredOrder = ['cash', 'investment', 'retirements', 'benefit', 'mortgage', 'credit_cards', 'other_assets'];
  summaryGroups.sort((a, b) => {
    const aIndex = preferredOrder.indexOf(a);
    const bIndex = preferredOrder.indexOf(b);
    return (aIndex < 0 ? 999 : aIndex) - (bIndex < 0 ? 999 : bIndex) || a.localeCompare(b);
  });

  const summaryRows = dates.map((date) => ({
    date,
    values: Object.fromEntries(summaryGroups.map((group) => {
      const groupAccountIds = Array.from(accountById.values())
        .filter((account) => Array.from(observations.values()).some((observation) => (
          observation.account_id === account.id && categoryById.get(observation.category_id)?.summary_group === group
        )))
        .map((account) => account.id);
      const present = groupAccountIds
        .map((accountId) => observations.get(`${date}|${accountId}`))
        .filter((value): value is ObservationRow => Boolean(
          value && categoryById.get(value.category_id)?.summary_group === group,
        ));
      if (present.length === 0) return [group, null];
      if (present.some((value) => !value.ok || value.balance_cents === null)) {
        return [group, { balance: null, ok: false, errorType: 'incomplete data' }];
      }
      return [group, {
        balance: present.reduce((sum, value) => sum + (value.balance_cents ?? 0), 0) / 100,
        ok: true,
        errorType: null,
      }];
    })),
  }));

  const latest = snapshotsResult.results.at(-1) ?? null;
  return Response.json({
    portfolio: { id: DEFAULT_PORTFOLIO_ID, name: 'Personal', currency: 'USD' },
    latestReportDate: dates.at(-1) ?? null,
    lastIngestedAt: latest?.ingested_at ?? null,
    dates,
    accountCount: observedAccountIds.size,
    summary: {
      columns: summaryGroups.map((id) => ({ id, name: id.replaceAll('_', ' ') })),
      rows: summaryRows,
    },
    categories: categorySheets,
  });
}
