import { env } from 'cloudflare:workers';

import { verifyBearerToken } from './auth-core';

export async function requireFinanceIngestToken(request: Request) {
  const result = await verifyBearerToken(
    request.headers.get('authorization'),
    env.FINANCE_INGEST_TOKEN_SHA256,
  );
  if (result.ok) return null;
  if (result.reason === 'not_configured') {
    return Response.json(
      { error: 'Finance ingestion is not configured' },
      { status: 503 },
    );
  }
  return Response.json(
    { error: 'A valid finance ingestion token is required' },
    {
      status: 401,
      headers: { 'WWW-Authenticate': 'Bearer realm="finance-ingestion"' },
    },
  );
}
