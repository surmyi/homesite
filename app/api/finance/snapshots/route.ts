import { DEFAULT_PORTFOLIO_ID, ensureFinanceSchema } from '@/db/finance';
import {
  AccountResolution,
  AccountResolutionError,
  IncomingAccount,
  MAX_FINANCE_BODY_BYTES,
  accountIdentityParts,
  appearsSensitive,
  categoryFor,
  categorySlug,
  deduplicateIncomingAccounts,
  resolveExistingAccount,
  safeBalanceCents,
  sha256,
  validateSnapshot,
} from '@/lib/finance-ingest';

export const runtime = 'edge';

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

function valuesClause(rowCount: number, columnCount: number) {
  const row = `(${Array.from({ length: columnCount }, () => '?').join(', ')})`;
  return Array.from({ length: rowCount }, () => row).join(', ');
}

function chunksForBoundVariables<T>(rows: T[], columnCount: number) {
  const chunkSize = Math.max(1, Math.floor(90 / columnCount));
  return Array.from(
    { length: Math.ceil(rows.length / chunkSize) },
    (_, index) => rows.slice(index * chunkSize, (index + 1) * chunkSize),
  );
}

function formatMoney(cents: number | null) {
  return cents === null ? null : Math.round(cents) / 100;
}

export async function POST(request: Request) {
  const rawJson = await request.text();
  if (new TextEncoder().encode(rawJson).byteLength > MAX_FINANCE_BODY_BYTES) {
    return Response.json({ error: 'Snapshot is too large' }, { status: 413 });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    return Response.json(
      { error: 'Snapshot must be valid JSON' },
      { status: 400 },
    );
  }
  if (!validateSnapshot(parsed)) {
    return Response.json(
      { error: 'Snapshot does not match the finance schema' },
      { status: 400 },
    );
  }
  if (appearsSensitive(parsed)) {
    return Response.json(
      {
        error:
          'Snapshot appears to contain an unmasked identifier or secret field',
      },
      { status: 400 },
    );
  }

  const db = await ensureFinanceSchema();
  const sourceHash = await sha256(rawJson);
  const idempotencyKey = request.headers.get('idempotency-key');
  if (idempotencyKey && idempotencyKey !== sourceHash) {
    return Response.json(
      {
        error:
          'Idempotency-Key must equal the SHA-256 hash of the request body',
      },
      { status: 400 },
    );
  }
  const existing = await db
    .prepare(
      'SELECT id, report_date FROM finance_snapshots WHERE source_hash = ?',
    )
    .bind(sourceHash)
    .first<{ id: string; report_date: string }>();
  if (existing) {
    return Response.json({
      ok: true,
      idempotent: true,
      snapshotId: existing.id,
      reportDate: existing.report_date,
    });
  }

  let deduplicated: Map<string, IncomingAccount>;
  try {
    deduplicated = deduplicateIncomingAccounts(parsed.accounts);
  } catch (error) {
    if (error instanceof AccountResolutionError) {
      return Response.json({ error: error.message }, { status: 422 });
    }
    throw error;
  }

  const warnings: string[] = [];
  const resolutionPlans = new Map<string, AccountResolution>();
  try {
    const plannedExistingAccountIds = new Set<string>();
    for (const [identityKey, incoming] of deduplicated) {
      const resolution = await resolveExistingAccount(
        db,
        incoming,
        parsed.report_date,
        DEFAULT_PORTFOLIO_ID,
      );
      if (
        resolution.account &&
        plannedExistingAccountIds.has(resolution.account.id)
      ) {
        return Response.json(
          { error: 'Two reported identities resolve to the same account' },
          { status: 422 },
        );
      }
      if (resolution.account)
        plannedExistingAccountIds.add(resolution.account.id);
      resolutionPlans.set(identityKey, resolution);
    }
  } catch (error) {
    if (error instanceof AccountResolutionError) {
      return Response.json({ error: error.message }, { status: 422 });
    }
    throw error;
  }

  const snapshotId = crypto.randomUUID();
  const now = new Date().toISOString();
  const reservedCanonicalKeys = new Set<string>();
  const institutionIds = new Map<string, string>();
  const institutions = new Map<
    string,
    {
      id: string;
      normalizedName: string;
      displayName: string;
    }
  >();
  const customCategories = new Map<
    string,
    {
      id: string;
      displayName: string;
      balanceKind: 'asset' | 'debt';
    }
  >();
  const plannedAccounts: Array<{
    accountId: string;
    categoryId: string;
    incoming: IncomingAccount;
    existing: boolean;
    institutionId: string;
    canonicalKey: string;
    lastFour: string | null;
    identifiers: Array<{ scheme: string; value: string; isPrimary: number }>;
  }> = [];

  for (const [identityKey, incoming] of deduplicated) {
    const identity = accountIdentityParts(incoming);
    let institutionId = institutionIds.get(identity.institution);
    if (!institutionId) {
      const existingInstitution = await db
        .prepare(
          'SELECT id FROM finance_institutions WHERE normalized_name = ?',
        )
        .bind(identity.institution)
        .first<{ id: string }>();
      institutionId =
        existingInstitution?.id ??
        `inst_${(await sha256(identity.institution)).slice(0, 20)}`;
      institutionIds.set(identity.institution, institutionId);
      institutions.set(identity.institution, {
        id: institutionId,
        normalizedName: identity.institution,
        displayName: incoming.institution.trim(),
      });
    }

    const categoryId =
      categoryFor(incoming.type) ?? `custom_${categorySlug(incoming.type)}`;
    if (!categoryFor(incoming.type) && !customCategories.has(categoryId)) {
      customCategories.set(categoryId, {
        id: categoryId,
        displayName: incoming.type.trim(),
        balanceKind:
          incoming.balance !== null && incoming.balance < 0 ? 'debt' : 'asset',
      });
    }

    const resolution = resolutionPlans.get(identityKey)!;
    const accountId = resolution.account?.id ?? crypto.randomUUID();
    let canonicalKey = resolution.account?.canonical_key ?? '';
    if (!resolution.account) {
      const canonicalBase = identity.lastFour
        ? `${identity.institution}:${identity.lastFour}`
        : `${identity.institution}:${identity.normalizedAccount}`;
      const existingCanonical = await db
        .prepare(
          'SELECT 1 AS found FROM finance_accounts WHERE portfolio_id = ? AND canonical_key = ?',
        )
        .bind(DEFAULT_PORTFOLIO_ID, canonicalBase)
        .first<{ found: number }>();
      canonicalKey =
        existingCanonical || reservedCanonicalKeys.has(canonicalBase)
          ? `${canonicalBase}:${accountId.slice(0, 8)}`
          : canonicalBase;
      reservedCanonicalKeys.add(canonicalKey);
    }

    const identifiers = [
      identity.sourceIdentifier
        ? {
            scheme: 'source_account_id',
            value: identity.sourceIdentifier,
            isPrimary: resolution.account ? 0 : 1,
          }
        : null,
      identity.lastFourIdentifier
        ? {
            scheme: 'institution_last4',
            value: identity.lastFourIdentifier,
            isPrimary: resolution.account || identity.sourceIdentifier ? 0 : 1,
          }
        : null,
      {
        scheme: 'institution_account_name',
        value: identity.nameIdentifier,
        isPrimary:
          resolution.account ||
          identity.sourceIdentifier ||
          identity.lastFourIdentifier
            ? 0
            : 1,
      },
    ].filter(
      (
        identifier,
      ): identifier is { scheme: string; value: string; isPrimary: number } =>
        Boolean(identifier),
    );

    plannedAccounts.push({
      accountId,
      categoryId,
      incoming,
      existing: Boolean(resolution.account),
      institutionId,
      canonicalKey,
      lastFour: identity.lastFour,
      identifiers,
    });
  }

  try {
    const statements: D1PreparedStatement[] = [];
    const institutionRows = Array.from(institutions.values());
    for (const rows of chunksForBoundVariables(institutionRows, 5)) {
      statements.push(
        db
          .prepare(
            `INSERT OR IGNORE INTO finance_institutions
         (id, normalized_name, display_name, created_at, updated_at)
         VALUES ${valuesClause(rows.length, 5)}`,
          )
          .bind(
            ...rows.flatMap((row) => [
              row.id,
              row.normalizedName,
              row.displayName,
              now,
              now,
            ]),
          ),
      );
    }

    const categoryRows = Array.from(customCategories.values());
    for (const rows of chunksForBoundVariables(categoryRows, 8)) {
      statements.push(
        db
          .prepare(
            `INSERT OR IGNORE INTO finance_categories
         (id, display_name, summary_group, balance_kind, sort_order, is_active, created_at, updated_at)
         VALUES ${valuesClause(rows.length, 8)}`,
          )
          .bind(
            ...rows.flatMap((row) => [
              row.id,
              row.displayName,
              row.id,
              row.balanceKind,
              500,
              1,
              now,
              now,
            ]),
          ),
      );
    }

    const newAccounts = plannedAccounts.filter((account) => !account.existing);
    for (const rows of chunksForBoundVariables(newAccounts, 13)) {
      statements.push(
        db
          .prepare(
            `INSERT INTO finance_accounts
         (id, portfolio_id, institution_id, canonical_key, display_name, last_four, source_type,
          default_category_id, category_override_id, status, metadata_json, created_at, updated_at)
         VALUES ${valuesClause(rows.length, 13)}`,
          )
          .bind(
            ...rows.flatMap((account) => [
              account.accountId,
              DEFAULT_PORTFOLIO_ID,
              account.institutionId,
              account.canonicalKey,
              account.incoming.account.trim(),
              account.lastFour,
              account.incoming.type.trim(),
              account.categoryId,
              null,
              'active',
              null,
              now,
              now,
            ]),
          ),
      );
    }

    for (const account of plannedAccounts.filter(
      (candidate) => candidate.existing,
    )) {
      statements.push(
        db
          .prepare(
            `UPDATE finance_accounts AS account
         SET source_type = ?, default_category_id = ?, updated_at = ?
         WHERE account.id = ?
           AND NOT EXISTS (
             SELECT 1
             FROM finance_observations AS observation
             JOIN finance_snapshots AS snapshot ON snapshot.id = observation.snapshot_id
             WHERE observation.account_id = account.id
               AND snapshot.portfolio_id = account.portfolio_id
               AND snapshot.is_current = 1
               AND snapshot.report_date > ?
           )`,
          )
          .bind(
            account.incoming.type.trim(),
            account.categoryId,
            now,
            account.accountId,
            parsed.report_date,
          ),
      );
    }

    const identifierRows = plannedAccounts.flatMap((account) =>
      account.identifiers.map((identifier) => ({
        ...identifier,
        accountId: account.accountId,
      })),
    );
    for (const rows of chunksForBoundVariables(identifierRows, 7)) {
      statements.push(
        db
          .prepare(
            `INSERT INTO finance_account_identifiers
         (account_id, scheme, value, is_primary, valid_from, valid_to, created_at)
         VALUES ${valuesClause(rows.length, 7)}
         ON CONFLICT(scheme, value, account_id) DO UPDATE SET
           valid_from = CASE
             WHEN finance_account_identifiers.valid_from IS NULL THEN NULL
             WHEN excluded.valid_from < finance_account_identifiers.valid_from THEN excluded.valid_from
             ELSE finance_account_identifiers.valid_from
           END,
           is_primary = CASE
             WHEN finance_account_identifiers.is_primary = 1 OR excluded.is_primary = 1 THEN 1
             ELSE 0
           END`,
          )
          .bind(
            ...rows.flatMap((row) => [
              row.accountId,
              row.scheme,
              row.value,
              row.isPrimary,
              parsed.report_date,
              null,
              now,
            ]),
          ),
      );
    }

    statements.push(
      db
        .prepare(
          `UPDATE finance_snapshots SET is_current = 0
         WHERE portfolio_id = ? AND report_date = ? AND is_current = 1`,
        )
        .bind(DEFAULT_PORTFOLIO_ID, parsed.report_date),
      db
        .prepare(
          `INSERT INTO finance_snapshots
         (id, portfolio_id, report_date, source, source_ref, source_hash, raw_json, is_current, warning_json, ingested_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        )
        .bind(
          snapshotId,
          DEFAULT_PORTFOLIO_ID,
          parsed.report_date,
          request.headers.get('x-finance-source')?.slice(0, 120) ||
            'auto-finance',
          request.headers.get('x-finance-source-ref')?.slice(0, 300) || null,
          sourceHash,
          rawJson,
          warnings.length ? JSON.stringify(warnings) : null,
          now,
        ),
    );

    for (const rows of chunksForBoundVariables(plannedAccounts, 10)) {
      statements.push(
        db
          .prepare(
            `INSERT INTO finance_observations
         (snapshot_id, account_id, category_id, balance_cents, ok, error_type,
          reported_institution, reported_account, reported_type, created_at)
         VALUES ${valuesClause(rows.length, 10)}`,
          )
          .bind(
            ...rows.flatMap((account) => [
              snapshotId,
              account.accountId,
              account.categoryId,
              safeBalanceCents(account.incoming.balance),
              account.incoming.ok ? 1 : 0,
              account.incoming.error_type,
              account.incoming.institution.trim(),
              account.incoming.account.trim(),
              account.incoming.type.trim(),
              now,
            ]),
          ),
      );
    }

    statements.push(
      db
        .prepare(
          `INSERT INTO finance_audit_log
         (portfolio_id, actor, action, entity_type, entity_id, before_json, after_json, created_at)
         VALUES (?, 'automation', 'ingest', 'snapshot', ?, NULL, ?, ?)`,
        )
        .bind(
          DEFAULT_PORTFOLIO_ID,
          snapshotId,
          JSON.stringify({
            reportDate: parsed.report_date,
            accountCount: plannedAccounts.length,
            sourceHash,
          }),
          now,
        ),
    );
    await db.batch(statements);
  } catch (error) {
    const concurrent = await db
      .prepare(
        'SELECT id, report_date FROM finance_snapshots WHERE source_hash = ?',
      )
      .bind(sourceHash)
      .first<{ id: string; report_date: string }>();
    if (concurrent) {
      return Response.json({
        ok: true,
        idempotent: true,
        snapshotId: concurrent.id,
        reportDate: concurrent.report_date,
      });
    }
    throw error;
  }

  return Response.json(
    {
      ok: true,
      idempotent: false,
      snapshotId,
      reportDate: parsed.report_date,
      accountCount: plannedAccounts.length,
      warnings,
    },
    { status: 201 },
  );
}

export async function GET() {
  const db = await ensureFinanceSchema();
  const [
    snapshotsResult,
    categoriesResult,
    accountsResult,
    observationsResult,
    overridesResult,
  ] = await Promise.all([
    db
      .prepare(
        `SELECT id, report_date, ingested_at
       FROM finance_snapshots
       WHERE portfolio_id = ? AND is_current = 1
       ORDER BY report_date`,
      )
      .bind(DEFAULT_PORTFOLIO_ID)
      .all<{ id: string; report_date: string; ingested_at: string }>(),
    db
      .prepare(
        `SELECT id, display_name, summary_group, balance_kind, sort_order
       FROM finance_categories WHERE is_active = 1 ORDER BY sort_order, display_name`,
      )
      .all<{
        id: string;
        display_name: string;
        summary_group: string;
        balance_kind: string;
        sort_order: number;
      }>(),
    db
      .prepare(
        `SELECT a.id, institution.display_name AS institution, a.display_name AS account,
              a.last_four, a.canonical_key,
              a.default_category_id AS category_id, a.category_override_id
       FROM finance_accounts AS a
       JOIN finance_institutions AS institution ON institution.id = a.institution_id
       WHERE a.portfolio_id = ? AND a.status != 'deleted'
       ORDER BY institution.display_name, a.display_name`,
      )
      .bind(DEFAULT_PORTFOLIO_ID)
      .all<{
        id: string;
        institution: string;
        account: string;
        last_four: string | null;
        canonical_key: string;
        category_id: string;
        category_override_id: string | null;
      }>(),
    db
      .prepare(
        `SELECT snapshot.report_date, observation.account_id, observation.category_id,
              observation.balance_cents, observation.ok, observation.error_type
       FROM finance_observations AS observation
       JOIN finance_snapshots AS snapshot ON snapshot.id = observation.snapshot_id
       WHERE snapshot.portfolio_id = ? AND snapshot.is_current = 1
       ORDER BY snapshot.report_date`,
      )
      .bind(DEFAULT_PORTFOLIO_ID)
      .all<ObservationRow>(),
    db
      .prepare(
        `SELECT report_date, account_id, operation, balance_cents, ok, error_type, category_id
       FROM finance_observation_overrides
       WHERE portfolio_id = ?
       ORDER BY report_date, account_id`,
      )
      .bind(DEFAULT_PORTFOLIO_ID)
      .all<OverrideRow>(),
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

  const categoryById = new Map(
    categoriesResult.results.map((category) => [category.id, category]),
  );
  const observations = new Map<string, ObservationRow>();
  for (const row of observationsResult.results) {
    observations.set(`${row.report_date}|${row.account_id}`, {
      ...row,
      category_id:
        accountById.get(row.account_id)?.categoryOverrideId ?? row.category_id,
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
      category_id:
        override.category_id ?? source?.category_id ?? fallbackCategory!,
      balance_cents:
        override.ok === 0 && override.balance_cents === null
          ? null
          : (override.balance_cents ?? source?.balance_cents ?? null),
      ok:
        override.ok ?? source?.ok ?? (override.balance_cents === null ? 0 : 1),
      error_type: override.error_type ?? source?.error_type ?? null,
    });
  }

  const dates = Array.from(
    new Set([
      ...snapshotsResult.results.map((snapshot) => snapshot.report_date),
      ...overridesResult.results.map((override) => override.report_date),
    ]),
  ).sort();
  const observedAccountIds = new Set(
    Array.from(observations.values(), (row) => row.account_id),
  );

  const categorySheets = categoriesResult.results
    .map((category) => {
      const categoryAccountIds = new Set(
        Array.from(observations.values())
          .filter((observation) => observation.category_id === category.id)
          .map((observation) => observation.account_id),
      );
      const accounts = Array.from(accountById.values()).filter((account) =>
        categoryAccountIds.has(account.id),
      );
      return {
        id: category.id,
        name: category.display_name,
        summaryGroup: category.summary_group,
        balanceKind: category.balance_kind,
        accounts,
        rows: dates.map((date) => ({
          date,
          values: Object.fromEntries(
            accounts.map((account) => {
              const candidate = observations.get(`${date}|${account.id}`);
              const value =
                candidate?.category_id === category.id ? candidate : null;
              return [
                account.id,
                value
                  ? {
                      balance: formatMoney(value.balance_cents),
                      ok: Boolean(value.ok),
                      errorType: value.error_type,
                    }
                  : null,
              ];
            }),
          ),
        })),
      };
    })
    .filter((category) => category.accounts.length > 0);

  const summaryGroups = Array.from(
    new Map(
      categorySheets.map((category) => [
        category.summaryGroup,
        category.summaryGroup,
      ]),
    ).keys(),
  );
  const preferredOrder = [
    'cash',
    'investment',
    'retirements',
    'benefit',
    'mortgage',
    'credit_cards',
    'other_assets',
  ];
  summaryGroups.sort((a, b) => {
    const aIndex = preferredOrder.indexOf(a);
    const bIndex = preferredOrder.indexOf(b);
    return (
      (aIndex < 0 ? 999 : aIndex) - (bIndex < 0 ? 999 : bIndex) ||
      a.localeCompare(b)
    );
  });

  const summaryRows = dates.map((date) => ({
    date,
    values: Object.fromEntries(
      summaryGroups.map((group) => {
        const groupAccountIds = Array.from(accountById.values())
          .filter((account) =>
            Array.from(observations.values()).some(
              (observation) =>
                observation.account_id === account.id &&
                categoryById.get(observation.category_id)?.summary_group ===
                  group,
            ),
          )
          .map((account) => account.id);
        const present = groupAccountIds
          .map((accountId) => observations.get(`${date}|${accountId}`))
          .filter((value): value is ObservationRow =>
            Boolean(
              value &&
              categoryById.get(value.category_id)?.summary_group === group,
            ),
          );
        if (present.length === 0) return [group, null];
        if (
          present.some((value) => !value.ok || value.balance_cents === null)
        ) {
          return [
            group,
            { balance: null, ok: false, errorType: 'incomplete data' },
          ];
        }
        return [
          group,
          {
            balance:
              present.reduce(
                (sum, value) => sum + (value.balance_cents ?? 0),
                0,
              ) / 100,
            ok: true,
            errorType: null,
          },
        ];
      }),
    ),
  }));

  const latest = snapshotsResult.results.at(-1) ?? null;
  return Response.json({
    portfolio: { id: DEFAULT_PORTFOLIO_ID, name: 'Personal', currency: 'USD' },
    latestReportDate: dates.at(-1) ?? null,
    lastIngestedAt: latest?.ingested_at ?? null,
    dates,
    accountCount: observedAccountIds.size,
    summary: {
      columns: summaryGroups.map((id) => ({
        id,
        name: id.replaceAll('_', ' '),
      })),
      rows: summaryRows,
    },
    categories: categorySheets,
  });
}
