import { env } from 'cloudflare:workers';

import {
  normalizeEmail,
  parseCookies,
  DEV_SESSION_COOKIE,
  SESSION_COOKIE,
  sha256Hex,
} from './auth-core';

export const BOOTSTRAP_ADMIN_EMAIL = 'hi.tianyiwu@gmail.com';

export type SiteRole = 'admin' | 'viewer';
export type AuthMode = 'sites' | 'google';

export type SiteUser = {
  id: string;
  email: string;
  displayName: string | null;
  role: SiteRole;
  provider: AuthMode;
};

export type AuthContext = {
  mode: AuthMode;
  identityEmail: string | null;
  user: SiteUser | null;
  reason: 'unauthenticated' | 'not_allowed' | 'disabled' | null;
};

const accessSchema = [
  `CREATE TABLE IF NOT EXISTS site_auth_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS site_access_users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL COLLATE NOCASE,
    normalized_email TEXT NOT NULL UNIQUE,
    display_name TEXT,
    role TEXT NOT NULL CHECK (role IN ('admin', 'viewer')),
    status TEXT NOT NULL CHECK (status IN ('active', 'disabled')) DEFAULT 'active',
    last_login_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    created_by TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_site_access_users_email
    ON site_access_users(email COLLATE NOCASE)`,
  `CREATE TABLE IF NOT EXISTS site_user_identities (
    provider TEXT NOT NULL,
    subject TEXT NOT NULL,
    access_user_id TEXT NOT NULL REFERENCES site_access_users(id) ON DELETE CASCADE,
    email_at_link TEXT NOT NULL,
    linked_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    PRIMARY KEY (provider, subject)
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_site_user_identity_per_provider
    ON site_user_identities(provider, access_user_id)`,
  `CREATE TABLE IF NOT EXISTS site_sessions (
    token_hash TEXT PRIMARY KEY,
    access_user_id TEXT NOT NULL REFERENCES site_access_users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    revoked_at TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_site_sessions_user
    ON site_sessions(access_user_id, expires_at)`,
  `CREATE TABLE IF NOT EXISTS site_access_audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_user_id TEXT,
    action TEXT NOT NULL,
    target_user_id TEXT NOT NULL,
    before_json TEXT,
    after_json TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_site_access_audit_target
    ON site_access_audit(target_user_id, created_at)`,
];

let schemaPromise: Promise<void> | null = null;

export function getAuthMode(): AuthMode {
  return env.AUTH_MODE === 'google' ? 'google' : 'sites';
}

export async function ensureAccessSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await env.DB.batch(
        accessSchema.map((statement) => env.DB.prepare(statement)),
      );
      const bootstrapped = await env.DB.prepare(
        `SELECT value FROM site_auth_meta WHERE key = 'bootstrap_admin_v1'`,
      ).first<{ value: string }>();
      if (!bootstrapped) {
        const now = new Date().toISOString();
        await env.DB.batch([
          env.DB.prepare(
            `INSERT OR IGNORE INTO site_access_users
              (id, email, normalized_email, display_name, role, status, created_at, updated_at, created_by)
             VALUES (?, ?, ?, ?, 'admin', 'active', ?, ?, 'bootstrap')`,
          ).bind(
            'usr_bootstrap_hi_tianyiwu',
            BOOTSTRAP_ADMIN_EMAIL,
            normalizeEmail(BOOTSTRAP_ADMIN_EMAIL),
            'Tianyi Wu',
            now,
            now,
          ),
          env.DB.prepare(
            `INSERT OR IGNORE INTO site_access_users
              (id, email, normalized_email, display_name, role, status, created_at, updated_at, created_by)
             VALUES (?, ?, ?, ?, 'admin', 'active', ?, ?, 'bootstrap')`,
          ).bind(
            'usr_bootstrap_sites_owner',
            'tianyiwu.95@gmail.com',
            'tianyiwu.95@gmail.com',
            'Tianyi Wu',
            now,
            now,
          ),
          env.DB.prepare(
            `INSERT OR IGNORE INTO site_auth_meta (key, value) VALUES ('bootstrap_admin_v1', ?)`,
          ).bind(now),
        ]);
      }
    })().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  await schemaPromise;
  return env.DB;
}

function decodeSitesName(headers: Headers) {
  const value = headers.get('oai-authenticated-user-full-name');
  if (!value) return null;
  if (
    headers.get('oai-authenticated-user-full-name-encoding') !==
    'percent-encoded-utf-8'
  ) {
    return value;
  }
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

type AccessRow = {
  id: string;
  email: string;
  display_name: string | null;
  role: SiteRole;
  status: 'active' | 'disabled';
};

async function findAndLinkSitesUser(headers: Headers) {
  const subject = headers.get('oai-authenticated-user-id');
  const sourceEmail = headers.get('oai-authenticated-user-email');
  if (!subject || !sourceEmail) return null;
  const email = normalizeEmail(sourceEmail);
  const db = await ensureAccessSchema();
  const byIdentity = await db
    .prepare(
      `SELECT user.id, user.email, user.display_name, user.role, user.status
     FROM site_user_identities AS identity
     JOIN site_access_users AS user ON user.id = identity.access_user_id
     WHERE identity.provider = 'sites' AND identity.subject = ?`,
    )
    .bind(subject)
    .first<AccessRow>();
  const row =
    byIdentity ??
    (await db
      .prepare(
        `SELECT id, email, display_name, role, status
     FROM site_access_users WHERE normalized_email = ?`,
      )
      .bind(email)
      .first<AccessRow>());
  if (!row) return { email, row: null };
  if (!byIdentity) {
    const now = new Date().toISOString();
    try {
      await db
        .prepare(
          `INSERT INTO site_user_identities
          (provider, subject, access_user_id, email_at_link, linked_at, last_seen_at)
         VALUES ('sites', ?, ?, ?, ?, ?)`,
        )
        .bind(subject, row.id, email, now, now)
        .run();
    } catch {
      return { email, row: null };
    }
  }
  const now = new Date().toISOString();
  await db.batch([
    db
      .prepare(
        `UPDATE site_user_identities SET last_seen_at = ?
       WHERE provider = 'sites' AND subject = ?`,
      )
      .bind(now, subject),
    db
      .prepare(
        `UPDATE site_access_users
       SET last_login_at = ?, display_name = COALESCE(display_name, ?)
       WHERE id = ?`,
      )
      .bind(now, decodeSitesName(headers), row.id),
  ]);
  return { email, row };
}

async function googleSessionContext(headers: Headers): Promise<AuthContext> {
  const cookies = parseCookies(headers.get('cookie'));
  const rawToken =
    cookies.get(SESSION_COOKIE) ?? cookies.get(DEV_SESSION_COOKIE);
  if (!rawToken) {
    return {
      mode: 'google',
      identityEmail: null,
      user: null,
      reason: 'unauthenticated',
    };
  }
  const db = await ensureAccessSchema();
  const tokenHash = await sha256Hex(rawToken);
  const now = new Date().toISOString();
  const row = await db
    .prepare(
      `SELECT user.id, user.email, user.display_name, user.role, user.status
     FROM site_sessions AS session
     JOIN site_access_users AS user ON user.id = session.access_user_id
     WHERE session.token_hash = ? AND session.revoked_at IS NULL AND session.expires_at > ?`,
    )
    .bind(tokenHash, now)
    .first<AccessRow>();
  if (!row) {
    return {
      mode: 'google',
      identityEmail: null,
      user: null,
      reason: 'unauthenticated',
    };
  }
  if (row.status !== 'active') {
    return {
      mode: 'google',
      identityEmail: row.email,
      user: null,
      reason: 'disabled',
    };
  }
  return {
    mode: 'google',
    identityEmail: row.email,
    user: {
      id: row.id,
      email: row.email,
      displayName: row.display_name,
      role: row.role,
      provider: 'google',
    },
    reason: null,
  };
}

export async function getAuthContext(headers: Headers): Promise<AuthContext> {
  const mode = getAuthMode();
  if (mode === 'google') return googleSessionContext(headers);
  const result = await findAndLinkSitesUser(headers);
  if (!result) {
    return {
      mode,
      identityEmail: null,
      user: null,
      reason: 'unauthenticated',
    };
  }
  if (!result.row) {
    return {
      mode,
      identityEmail: result.email,
      user: null,
      reason: 'not_allowed',
    };
  }
  if (result.row.status !== 'active') {
    return {
      mode,
      identityEmail: result.email,
      user: null,
      reason: 'disabled',
    };
  }
  return {
    mode,
    identityEmail: result.email,
    user: {
      id: result.row.id,
      email: result.row.email,
      displayName: result.row.display_name,
      role: result.row.role,
      provider: mode,
    },
    reason: null,
  };
}

export async function authorizeRequest(
  request: Request,
  requiredRole?: SiteRole,
) {
  const context = await getAuthContext(request.headers);
  if (!context.user) {
    const status = context.reason === 'unauthenticated' ? 401 : 403;
    return {
      response: Response.json(
        {
          error:
            status === 401
              ? 'Authentication required'
              : 'You do not have access to this site',
        },
        {
          status,
          headers: {
            'Cache-Control': 'private, no-store',
            ...(status === 401
              ? {
                  'WWW-Authenticate':
                    context.mode === 'google' ? 'Session' : 'OpenAI-Sites',
                }
              : {}),
          },
        },
      ),
    } as const;
  }
  if (requiredRole === 'admin' && context.user.role !== 'admin') {
    return {
      response: Response.json(
        { error: 'Administrator access required' },
        { status: 403, headers: { 'Cache-Control': 'private, no-store' } },
      ),
    } as const;
  }
  return { user: context.user } as const;
}

export function requireSameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  return Boolean(origin && origin === new URL(request.url).origin);
}

export async function findGoogleAccessUser(identity: {
  subject: string;
  email: string;
  displayName: string | null;
}) {
  const db = await ensureAccessSchema();
  const email = normalizeEmail(identity.email);
  const byIdentity = await db
    .prepare(
      `SELECT user.id, user.email, user.display_name, user.role, user.status
     FROM site_user_identities AS identity
     JOIN site_access_users AS user ON user.id = identity.access_user_id
     WHERE identity.provider = 'google' AND identity.subject = ?`,
    )
    .bind(identity.subject)
    .first<AccessRow>();
  if (byIdentity) {
    if (normalizeEmail(byIdentity.email) !== email) return null;
    if (byIdentity.status !== 'active') return null;
    const now = new Date().toISOString();
    await db.batch([
      db
        .prepare(
          `UPDATE site_user_identities SET last_seen_at = ?
         WHERE provider = 'google' AND subject = ?`,
        )
        .bind(now, identity.subject),
      db
        .prepare(`UPDATE site_access_users SET last_login_at = ? WHERE id = ?`)
        .bind(now, byIdentity.id),
    ]);
    return byIdentity;
  }
  const row = await db
    .prepare(
      `SELECT id, email, display_name, role, status
     FROM site_access_users WHERE normalized_email = ?`,
    )
    .bind(email)
    .first<AccessRow>();
  if (!row || row.status !== 'active') return null;
  const now = new Date().toISOString();
  try {
    await db.batch([
      db
        .prepare(
          `INSERT INTO site_user_identities
          (provider, subject, access_user_id, email_at_link, linked_at, last_seen_at)
         VALUES ('google', ?, ?, ?, ?, ?)`,
        )
        .bind(identity.subject, row.id, email, now, now),
      db
        .prepare(
          `UPDATE site_access_users
         SET display_name = COALESCE(display_name, ?), last_login_at = ?, updated_at = ?
         WHERE id = ?`,
        )
        .bind(identity.displayName, now, now, row.id),
    ]);
  } catch {
    return null;
  }
  return row;
}

export async function createSiteSession(userId: string, rawToken: string) {
  const db = await ensureAccessSchema();
  const tokenHash = await sha256Hex(rawToken);
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + 12 * 60 * 60 * 1000);
  await db
    .prepare(
      `INSERT INTO site_sessions
      (token_hash, access_user_id, created_at, expires_at, revoked_at)
     VALUES (?, ?, ?, ?, NULL)`,
    )
    .bind(tokenHash, userId, createdAt.toISOString(), expiresAt.toISOString())
    .run();
  return expiresAt;
}

export async function revokeSiteSession(rawToken: string | undefined) {
  if (!rawToken) return;
  const db = await ensureAccessSchema();
  await db
    .prepare(
      `UPDATE site_sessions SET revoked_at = ?
     WHERE token_hash = ? AND revoked_at IS NULL`,
    )
    .bind(new Date().toISOString(), await sha256Hex(rawToken))
    .run();
}
