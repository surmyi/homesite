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
  normalized_email: string;
  display_name: string | null;
  role: 'admin' | 'viewer';
  status: 'active' | 'disabled';
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
};

function validEmail(value: string) {
  return value.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

async function routeId(context: {
  params: Promise<{ id: string }> | { id: string };
}) {
  return (await context.params).id;
}

async function activeAdminCount(db: D1Database) {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS count FROM site_access_users
     WHERE role = 'admin' AND status = 'active'`,
    )
    .first<{ count: number }>();
  return Number(row?.count ?? 0);
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> | { id: string } },
) {
  const authorization = await authorizeRequest(request, 'admin');
  if ('response' in authorization) return authorization.response;
  if (!requireSameOrigin(request)) {
    return Response.json({ error: 'Invalid request origin' }, { status: 403 });
  }
  const id = await routeId(context);
  const db = await ensureAccessSchema();
  const before = await db
    .prepare(
      `SELECT id, email, normalized_email, display_name, role, status,
            last_login_at, created_at, updated_at
     FROM site_access_users WHERE id = ?`,
    )
    .bind(id)
    .first<AccessRow>();
  if (!before)
    return Response.json({ error: 'Access record not found' }, { status: 404 });

  const body = (await request.json().catch(() => null)) as {
    email?: unknown;
    displayName?: unknown;
    role?: unknown;
    status?: unknown;
  } | null;
  if (!body || Object.keys(body).length === 0) {
    return Response.json({ error: 'No changes supplied' }, { status: 400 });
  }
  const email =
    body.email === undefined
      ? before.email
      : typeof body.email === 'string'
        ? normalizeEmail(body.email)
        : '';
  const displayName =
    body.displayName === undefined
      ? before.display_name
      : body.displayName === null
        ? null
        : typeof body.displayName === 'string'
          ? body.displayName.trim() || null
          : undefined;
  const role = body.role === undefined ? before.role : body.role;
  const status = body.status === undefined ? before.status : body.status;
  if (
    !validEmail(email) ||
    displayName === undefined ||
    (displayName !== null && displayName.length > 120) ||
    (role !== 'admin' && role !== 'viewer') ||
    (status !== 'active' && status !== 'disabled')
  ) {
    return Response.json({ error: 'Invalid access record' }, { status: 400 });
  }
  const removesActiveAdmin =
    before.role === 'admin' &&
    before.status === 'active' &&
    (role !== 'admin' || status !== 'active');
  if (removesActiveAdmin && (await activeAdminCount(db)) <= 1) {
    return Response.json(
      {
        error: 'Add another active administrator before changing the last one',
      },
      { status: 409 },
    );
  }

  const now = new Date().toISOString();
  const emailChanged = normalizeEmail(before.email) !== email;
  try {
    const statements = [
      db
        .prepare(
          `UPDATE site_access_users
         SET email = ?, normalized_email = ?, display_name = ?, role = ?, status = ?, updated_at = ?
         WHERE id = ?`,
        )
        .bind(email, email, displayName, role, status, now, id),
      db
        .prepare(
          `INSERT INTO site_access_audit
          (actor_user_id, action, target_user_id, before_json, after_json, created_at)
         VALUES (?, 'update', ?, ?, ?, ?)`,
        )
        .bind(
          authorization.user.id,
          id,
          JSON.stringify(before),
          JSON.stringify({ email, displayName, role, status }),
          now,
        ),
    ];
    if (emailChanged) {
      statements.push(
        db
          .prepare(`DELETE FROM site_user_identities WHERE access_user_id = ?`)
          .bind(id),
      );
    }
    if (emailChanged || status === 'disabled') {
      statements.push(
        db
          .prepare(
            `UPDATE site_sessions SET revoked_at = ?
           WHERE access_user_id = ? AND revoked_at IS NULL`,
          )
          .bind(now, id),
      );
    }
    await db.batch(statements);
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
        lastLoginAt: before.last_login_at,
        createdAt: before.created_at,
        updatedAt: now,
        identityProviders: emailChanged ? [] : undefined,
      },
    },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> | { id: string } },
) {
  const authorization = await authorizeRequest(request, 'admin');
  if ('response' in authorization) return authorization.response;
  if (!requireSameOrigin(request)) {
    return Response.json({ error: 'Invalid request origin' }, { status: 403 });
  }
  const id = await routeId(context);
  const db = await ensureAccessSchema();
  const before = await db
    .prepare(
      `SELECT id, email, normalized_email, display_name, role, status,
            last_login_at, created_at, updated_at
     FROM site_access_users WHERE id = ?`,
    )
    .bind(id)
    .first<AccessRow>();
  if (!before)
    return Response.json({ error: 'Access record not found' }, { status: 404 });
  if (
    before.role === 'admin' &&
    before.status === 'active' &&
    (await activeAdminCount(db)) <= 1
  ) {
    return Response.json(
      {
        error: 'Add another active administrator before deleting the last one',
      },
      { status: 409 },
    );
  }
  const now = new Date().toISOString();
  await db.batch([
    db.prepare(`DELETE FROM site_sessions WHERE access_user_id = ?`).bind(id),
    db
      .prepare(`DELETE FROM site_user_identities WHERE access_user_id = ?`)
      .bind(id),
    db.prepare(`DELETE FROM site_access_users WHERE id = ?`).bind(id),
    db
      .prepare(
        `INSERT INTO site_access_audit
        (actor_user_id, action, target_user_id, before_json, after_json, created_at)
       VALUES (?, 'delete', ?, ?, NULL, ?)`,
      )
      .bind(authorization.user.id, id, JSON.stringify(before), now),
  ]);
  return new Response(null, {
    status: 204,
    headers: { 'Cache-Control': 'no-store' },
  });
}
