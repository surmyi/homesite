export const MAX_FINANCE_BODY_BYTES = 1_000_000;

export type IncomingAccount = {
  source_account_id?: string;
  institution: string;
  account: string;
  type: string;
  balance: number | null;
  ok: boolean;
  error_type: string | null;
};

export type IncomingSnapshot = {
  report_date: string;
  accounts: IncomingAccount[];
};

export type AccountRow = {
  id: string;
  canonical_key: string;
  display_name: string;
  status: 'active' | 'inactive' | 'deleted';
};

export type AccountIdentifierScheme =
  | 'source_account_id'
  | 'institution_account_name'
  | 'institution_last4';

export type AccountResolution = {
  account: AccountRow | null;
  identityKey: string;
  matchedBy: AccountIdentifierScheme | null;
  requiresValidityExtension: boolean;
};

export class AccountResolutionError extends Error {}

export function normalizeIdentity(value: string) {
  return value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function extractLastFour(value: string) {
  return (
    value.match(/(?:[•*xX]{2,}|ending\s+in\s+)(\d{4})\b/i)?.[1] ??
    value.match(/(?:^|\D)(\d{4})\s*$/)?.[1] ??
    null
  );
}

export function accountIdentityParts(incoming: IncomingAccount) {
  const institution = normalizeIdentity(incoming.institution);
  const normalizedAccount = normalizeIdentity(incoming.account);
  const lastFour = extractLastFour(incoming.account);
  const sourceIdentifier = incoming.source_account_id
    ? `${institution}|${incoming.source_account_id.trim()}`
    : null;
  const nameIdentifier = `${institution}|${normalizedAccount}`;
  const lastFourIdentifier = lastFour ? `${institution}|${lastFour}` : null;
  const identityKey = sourceIdentifier
    ? `source|${sourceIdentifier}`
    : `${institution}|${lastFour ?? normalizedAccount}`;
  return {
    institution,
    normalizedAccount,
    lastFour,
    sourceIdentifier,
    nameIdentifier,
    lastFourIdentifier,
    identityKey,
  };
}

export function deduplicateIncomingAccounts(accounts: IncomingAccount[]) {
  const deduplicated = new Map<string, IncomingAccount>();
  const aliasOwners = new Map<string, string>();
  for (const account of accounts) {
    const identity = accountIdentityParts(account);
    if (deduplicated.has(identity.identityKey)) {
      throw new AccountResolutionError(
        'Snapshot contains a duplicate account identity',
      );
    }

    const aliases = [
      identity.sourceIdentifier
        ? `source_account_id|${identity.sourceIdentifier}`
        : null,
      `institution_account_name|${identity.nameIdentifier}`,
      identity.lastFourIdentifier
        ? `institution_last4|${identity.lastFourIdentifier}`
        : null,
    ].filter((alias): alias is string => Boolean(alias));
    for (const alias of aliases) {
      const owner = aliasOwners.get(alias);
      if (owner && owner !== identity.identityKey) {
        throw new AccountResolutionError(
          'Two reported identities share an account identifier',
        );
      }
      aliasOwners.set(alias, identity.identityKey);
    }
    deduplicated.set(identity.identityKey, account);
  }
  return deduplicated;
}

export function categoryFor(type: string) {
  const normalized = normalizeIdentity(type);
  if (normalized.includes('401')) return '401k';
  if (normalized.includes('roth') && normalized.includes('ira'))
    return 'roth_ira';
  if (normalized === 'ira' || normalized.includes('traditional ira'))
    return 'ira';
  if (
    normalized.includes('hsa') ||
    normalized.includes('fsa') ||
    normalized.includes('benefit')
  )
    return 'benefit';
  if (normalized.includes('mortgage')) return 'mortgage';
  if (normalized.includes('credit card') || normalized.includes('creditcard'))
    return 'credit_card';
  if (
    normalized.includes('brokerage') ||
    normalized.includes('investment') ||
    normalized.includes('rsu')
  )
    return 'brokerage';
  if (
    normalized.includes('cash') ||
    normalized.includes('checking') ||
    normalized.includes('saving')
  )
    return 'cash';
  if (normalized.includes('asset') || normalized.includes('crypto'))
    return 'other_asset';
  return null;
}

export function categorySlug(value: string) {
  return (
    normalizeIdentity(value).replaceAll(' ', '_').slice(0, 48) ||
    'uncategorized'
  );
}

export function appearsSensitive(value: unknown, key = ''): boolean {
  if (
    /(?:authorization|password|passwd|secret|(?:access[_-]?)?token|api[_-]?key|account[_-]?(?:number|no)|routing[_-]?(?:number|no))/i.test(
      key,
    )
  ) {
    return true;
  }
  if (typeof value === 'string') {
    if (key !== 'account') return false;
    if (/\d{5,}/.test(value)) return true;
    return (value.match(/\d{4}/g) ?? []).length > 1;
  }
  if (Array.isArray(value)) return value.some((item) => appearsSensitive(item));
  if (value && typeof value === 'object') {
    return Object.entries(value).some(([childKey, childValue]) =>
      appearsSensitive(childValue, childKey),
    );
  }
  return false;
}

export function safeBalanceCents(balance: number | null) {
  if (balance === null) return null;
  const cents = Math.round(balance * 100);
  return Number.isSafeInteger(cents) ? cents : null;
}

export function validateSnapshot(value: unknown): value is IncomingSnapshot {
  if (!value || typeof value !== 'object') return false;
  const snapshot = value as Partial<IncomingSnapshot>;
  if (
    typeof snapshot.report_date !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(snapshot.report_date)
  )
    return false;
  const parsedDate = new Date(`${snapshot.report_date}T00:00:00Z`);
  if (
    Number.isNaN(parsedDate.valueOf()) ||
    parsedDate.toISOString().slice(0, 10) !== snapshot.report_date
  )
    return false;
  if (
    !Array.isArray(snapshot.accounts) ||
    snapshot.accounts.length < 1 ||
    snapshot.accounts.length > 500
  )
    return false;
  return snapshot.accounts.every(
    (account) =>
      account &&
      (account.source_account_id === undefined ||
        (typeof account.source_account_id === 'string' &&
          account.source_account_id.trim().length > 0 &&
          account.source_account_id.length <= 180)) &&
      typeof account.institution === 'string' &&
      account.institution.trim().length > 0 &&
      account.institution.length <= 180 &&
      normalizeIdentity(account.institution).length > 0 &&
      typeof account.account === 'string' &&
      account.account.trim().length > 0 &&
      account.account.length <= 240 &&
      normalizeIdentity(account.account).length > 0 &&
      typeof account.type === 'string' &&
      account.type.trim().length > 0 &&
      account.type.length <= 120 &&
      normalizeIdentity(account.type).length > 0 &&
      (account.balance === null ||
        (typeof account.balance === 'number' &&
          Number.isFinite(account.balance) &&
          safeBalanceCents(account.balance) !== null)) &&
      typeof account.ok === 'boolean' &&
      (account.error_type === null ||
        (typeof account.error_type === 'string' &&
          account.error_type.length <= 160)),
  );
}

export async function sha256(value: string) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

async function matchingAccounts(
  db: D1Database,
  scheme: AccountIdentifierScheme,
  value: string,
  reportDate: string,
  retroactive: boolean,
  portfolioId: string,
) {
  const validitySql = retroactive
    ? '(identifier.valid_to IS NULL OR identifier.valid_to >= ?)'
    : `(identifier.valid_from IS NULL OR identifier.valid_from <= ?)
       AND (identifier.valid_to IS NULL OR identifier.valid_to >= ?)`;
  const statement = db.prepare(
    `SELECT a.id, a.canonical_key, a.display_name, a.status
     FROM finance_account_identifiers AS identifier
     JOIN finance_accounts AS a ON a.id = identifier.account_id
     WHERE identifier.scheme = ? AND identifier.value = ?
       AND ${validitySql}
       AND a.portfolio_id = ?
     ORDER BY a.created_at`,
  );
  return retroactive
    ? statement.bind(scheme, value, reportDate, portfolioId).all<AccountRow>()
    : statement
        .bind(scheme, value, reportDate, reportDate, portfolioId)
        .all<AccountRow>();
}

export async function resolveExistingAccount(
  db: D1Database,
  incoming: IncomingAccount,
  reportDate: string,
  portfolioId: string,
): Promise<AccountResolution> {
  const identity = accountIdentityParts(incoming);
  const candidates: Array<{
    scheme: AccountIdentifierScheme;
    value: string | null;
  }> = [
    { scheme: 'source_account_id', value: identity.sourceIdentifier },
    { scheme: 'institution_account_name', value: identity.nameIdentifier },
    { scheme: 'institution_last4', value: identity.lastFourIdentifier },
  ];

  const exactMatches: Array<{
    account: AccountRow;
    matchedBy: AccountIdentifierScheme;
  }> = [];
  const exactByScheme = new Map<AccountIdentifierScheme, AccountRow>();
  for (const candidate of candidates) {
    if (!candidate.value) continue;
    const exact = await matchingAccounts(
      db,
      candidate.scheme,
      candidate.value,
      reportDate,
      false,
      portfolioId,
    );
    if (exact.results.length > 1)
      throw new AccountResolutionError(`${candidate.scheme} is ambiguous`);
    if (exact.results[0]) {
      exactByScheme.set(candidate.scheme, exact.results[0]);
      exactMatches.push({
        account: exact.results[0],
        matchedBy: candidate.scheme,
      });
    }
  }

  const exactAccountIds = new Set(
    exactMatches.map((match) => match.account.id),
  );
  if (exactAccountIds.size > 1) {
    throw new AccountResolutionError(
      'Account name and identifier resolve to different accounts',
    );
  }

  if (exactMatches.length > 0) {
    const strongest = exactMatches.sort(
      (left, right) =>
        candidates.findIndex(
          (candidate) => candidate.scheme === left.matchedBy,
        ) -
        candidates.findIndex(
          (candidate) => candidate.scheme === right.matchedBy,
        ),
    )[0];
    let requiresValidityExtension = false;
    for (const candidate of candidates) {
      if (!candidate.value || exactByScheme.has(candidate.scheme)) continue;
      const retroactive = await matchingAccounts(
        db,
        candidate.scheme,
        candidate.value,
        reportDate,
        true,
        portfolioId,
      );
      if (retroactive.results.length > 1)
        throw new AccountResolutionError(`${candidate.scheme} is ambiguous`);
      if (
        retroactive.results[0] &&
        retroactive.results[0].id !== strongest.account.id
      ) {
        throw new AccountResolutionError(
          'Account name and identifier resolve to different accounts',
        );
      }
      if (retroactive.results[0]) requiresValidityExtension = true;
    }
    if (strongest.account.status === 'deleted') {
      throw new AccountResolutionError(
        'Historical identity resolves to a deleted account',
      );
    }
    return {
      account: strongest.account,
      identityKey: identity.identityKey,
      matchedBy: strongest.matchedBy,
      requiresValidityExtension,
    };
  }

  const retroactiveByScheme = new Map<AccountIdentifierScheme, AccountRow>();
  for (const candidate of candidates) {
    if (!candidate.value) continue;
    const retroactive = await matchingAccounts(
      db,
      candidate.scheme,
      candidate.value,
      reportDate,
      true,
      portfolioId,
    );
    if (retroactive.results.length > 1)
      throw new AccountResolutionError(`${candidate.scheme} is ambiguous`);
    if (retroactive.results[0])
      retroactiveByScheme.set(candidate.scheme, retroactive.results[0]);
  }

  const sourceMatch = retroactiveByScheme.get('source_account_id');
  const nameMatch = retroactiveByScheme.get('institution_account_name');
  const lastFourMatch = retroactiveByScheme.get('institution_last4');
  const retroactiveAccountIds = new Set(
    [sourceMatch, nameMatch, lastFourMatch]
      .filter((account): account is AccountRow => Boolean(account))
      .map((account) => account.id),
  );
  if (retroactiveAccountIds.size > 1) {
    throw new AccountResolutionError(
      'Account name and identifier resolve to different accounts',
    );
  }

  const historicalMatch = sourceMatch ?? nameMatch ?? null;
  if (!historicalMatch && lastFourMatch) {
    throw new AccountResolutionError(
      'Historical account cannot be safely matched by last four digits alone',
    );
  }
  if (historicalMatch?.status === 'deleted') {
    throw new AccountResolutionError(
      'Historical identity resolves to a deleted account',
    );
  }
  if (historicalMatch) {
    return {
      account: historicalMatch,
      identityKey: identity.identityKey,
      matchedBy: sourceMatch ? 'source_account_id' : 'institution_account_name',
      requiresValidityExtension: true,
    };
  }

  return {
    account: null,
    identityKey: identity.identityKey,
    matchedBy: null,
    requiresValidityExtension: false,
  };
}
