import { DEFAULT_PORTFOLIO_ID, getFinanceDb } from '@/db/finance';
import {
  AccountResolutionError,
  IncomingAccount,
  MAX_FINANCE_BODY_BYTES,
  appearsSensitive,
  categoryFor,
  categorySlug,
  deduplicateIncomingAccounts,
  normalizeIdentity,
  resolveExistingAccount,
  sha256,
  validateSnapshot,
} from '@/lib/finance-ingest';
import { requireFinanceIngestToken } from '@/lib/finance-auth';

export const runtime = 'edge';

type SnapshotRow = {
  report_date: string;
  source_hash: string;
  is_current: number;
};

export async function POST(request: Request) {
  const authError = await requireFinanceIngestToken(request);
  if (authError) return authError;
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

  let deduplicated: Map<string, IncomingAccount>;
  try {
    deduplicated = deduplicateIncomingAccounts(parsed.accounts);
  } catch (error) {
    if (error instanceof AccountResolutionError) {
      return Response.json({ error: error.message }, { status: 422 });
    }
    throw error;
  }

  const db = getFinanceDb();
  const [existingHash, currentDate] = await Promise.all([
    db
      .prepare(
        `SELECT report_date, source_hash, is_current
       FROM finance_snapshots WHERE source_hash = ?`,
      )
      .bind(sourceHash)
      .first<SnapshotRow>(),
    db
      .prepare(
        `SELECT report_date, source_hash, is_current
       FROM finance_snapshots
       WHERE portfolio_id = ? AND report_date = ? AND is_current = 1`,
      )
      .bind(DEFAULT_PORTFOLIO_ID, parsed.report_date)
      .first<SnapshotRow>(),
  ]);

  if (existingHash) {
    const existingSnapshotIsNonCurrent = !existingHash.is_current;
    return Response.json({
      ok: true,
      preflight: true,
      reportDate: parsed.report_date,
      sourceHash,
      accountCount: deduplicated.size,
      idempotent: true,
      existingSnapshotIsNonCurrent,
      wouldReplaceCurrent: false,
      resolutions: await Promise.all(
        Array.from(deduplicated.keys(), async (identityKey) => ({
          token: await sha256(identityKey),
          action: 'match',
          matchedBy: null,
          categoryAction: 'match',
          institutionAction: 'match',
        })),
      ),
      warnings: existingSnapshotIsNonCurrent
        ? [
            'The exact payload already exists as a non-current snapshot; ingestion would be a no-op.',
          ]
        : [],
    });
  }

  const resolutions: Array<{
    token: string;
    action: 'match' | 'extend_identifier_valid_from' | 'create_account';
    matchedBy: string | null;
    categoryAction: 'match' | 'create' | 'inactive';
    institutionAction: 'match' | 'create';
  }> = [];
  const plannedExistingAccountIds = new Set<string>();

  try {
    for (const [identityKey, incoming] of deduplicated) {
      const categoryId =
        categoryFor(incoming.type) ?? `custom_${categorySlug(incoming.type)}`;
      const [resolution, category, institution] = await Promise.all([
        resolveExistingAccount(
          db,
          incoming,
          parsed.report_date,
          DEFAULT_PORTFOLIO_ID,
        ),
        db
          .prepare('SELECT is_active FROM finance_categories WHERE id = ?')
          .bind(categoryId)
          .first<{ is_active: number }>(),
        db
          .prepare(
            'SELECT id FROM finance_institutions WHERE normalized_name = ?',
          )
          .bind(normalizeIdentity(incoming.institution))
          .first<{ id: string }>(),
      ]);

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

      resolutions.push({
        token: await sha256(identityKey),
        action: resolution.account
          ? resolution.requiresValidityExtension
            ? 'extend_identifier_valid_from'
            : 'match'
          : 'create_account',
        matchedBy: resolution.matchedBy,
        categoryAction: !category
          ? 'create'
          : category.is_active
            ? 'match'
            : 'inactive',
        institutionAction: institution ? 'match' : 'create',
      });
    }
  } catch (error) {
    if (error instanceof AccountResolutionError) {
      return Response.json({ error: error.message }, { status: 422 });
    }
    throw error;
  }

  const wouldReplaceCurrent = Boolean(
    currentDate && currentDate.source_hash !== sourceHash,
  );
  const warnings = [
    wouldReplaceCurrent
      ? 'A different current snapshot already exists for this report date.'
      : null,
    resolutions.some((resolution) => resolution.categoryAction === 'inactive')
      ? 'At least one account maps to an inactive category.'
      : null,
  ].filter((warning): warning is string => Boolean(warning));

  return Response.json({
    ok: true,
    preflight: true,
    reportDate: parsed.report_date,
    sourceHash,
    accountCount: resolutions.length,
    idempotent: false,
    existingSnapshotIsNonCurrent: false,
    wouldReplaceCurrent,
    resolutions,
    warnings,
  });
}
