import { normalizeEmail } from '@/lib/auth-core';
import {
  authorizeRequest,
  ensureAccessSchema,
  requireSameOrigin,
} from '@/lib/site-auth';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

type AccessRow = {
  id: string;
  email: string;
  display_name: string | null;
  role: 'admin' | 'viewer';
  status: 'active' | 'disabled';
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
  identity_providers: string | null;
};

function serializeUser(row: AccessRow) {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    status: row.status,
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    identityProviders: row.identity_providers?.split(',').filter(Boolean) ?? [],
  };
}

function validEmail(value: string) {
  return value.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export async function GET(request: Request) {
  const authorization = await authorizeRequest(request, 'admin');
  if ('response' in authorization) return authorization.response;
  const db = await ensureAccessSchema();
  const rows = await db
    .prepare(
      `SELECT user.id, user.email, user.display_name, user.role, user.status,
            user.last_login_at, user.created_at, user.updated_at,
            GROUP_CONCAT(identity.provider) AS identity_providers
     FROM site_access_users AS user
     LEFT JOIN site_user_identities AS identity ON identity.access_user_id = user.id
     GROUP BY user.id
     ORDER BY CASE user.role WHEN 'admin' THEN 0 ELSE 1 END,
              CASE user.status WHEN 'active' THEN 0 ELSE 1 END,
              user.email`,
    )
    .all<AccessRow>();
  return Response.json(
    { users: rows.results.map(serializeUser) },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}

export async function POST(request: Request) {
  const authorization = await authorizeRequest(request, 'admin');
  if ('response' in authorization) return authorization.response;
  if (!requireSameOrigin(request)) {
    return Response.json({ error: 'Invalid request origin' }, { status: 403 });
  }
  const body = (await request.json().catch(() => null)) as {
    email?: unknown;
    displayName?: unknown;
    role?: unknown;
    status?: unknown;
  } | null;
  const email =
    typeof body?.email === 'string' ? normalizeEmail(body.email) : '';
  const displayName =
    typeof body?.displayName === 'string'
      ? body.displayName.trim() || null
      : body?.displayName === null || body?.displayName === undefined
        ? null
        : undefined;
  const role = body?.role ?? 'viewer';
  const status = body?.status ?? 'active';
  if (
    !validEmail(email) ||
    displayName === undefined ||
    (displayName !== null && displayName.length > 120) ||
    (role !== 'admin' && role !== 'viewer') ||
    (status !== 'active' && status !== 'disabled')
  ) {
    return Response.json({ error: 'Invalid access record' }, { status: 400 });
  }
  const db = await ensureAccessSchema();
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  try {
    await db.batch([
      db
        .prepare(
          `INSERT INTO site_access_users
          (id, email, normalized_email, display_name, role, status,
           created_at, updated_at, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          id,
          email,
          email,
          displayName,
          role,
          status,
          now,
          now,
          authorization.user.id,
        ),
      db
        .prepare(
          `INSERT INTO site_access_audit
          (actor_user_id, action, target_user_id, before_json, after_json, created_at)
         VALUES (?, 'create', ?, NULL, ?, ?)`,
        )
        .bind(
          authorization.user.id,
          id,
          JSON.stringify({ email, displayName, role, status }),
          now,
        ),
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message.toLowerCase().includes('unique')) {
      return Response.json(
        { error: 'That email already has an access record' },
        { status: 409 },
      );
    }
    throw error;
  }
  return Response.json(
    {
      user: {
        id,
        email,
        displayName,
        role,
        status,
        lastLoginAt: null,
        createdAt: now,
        updatedAt: now,
        identityProviders: [],
      },
    },
    { status: 201, headers: { 'Cache-Control': 'private, no-store' } },
  );
}
