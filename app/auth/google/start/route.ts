import { env } from 'cloudflare:workers';

import {
  OAUTH_NONCE_COOKIE,
  OAUTH_RETURN_TO_COOKIE,
  OAUTH_STATE_COOKIE,
  OAUTH_VERIFIER_COOKIE,
  randomBase64Url,
  safeReturnTo,
  serializeCookie,
  sha256Base64Url,
} from '@/lib/auth-core';
import { getAuthMode } from '@/lib/site-auth';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

function unavailable() {
  return Response.json(
    { error: 'Google sign-in is not configured yet' },
    { status: 503, headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function GET(request: Request) {
  if (getAuthMode() !== 'google') {
    return Response.redirect(new URL('/', request.url), 302);
  }
  if (
    !env.GOOGLE_CLIENT_ID ||
    !env.GOOGLE_CLIENT_SECRET ||
    !env.GOOGLE_REDIRECT_URI ||
    !env.APP_ORIGIN
  ) {
    return unavailable();
  }
  const requestUrl = new URL(request.url);
  const state = randomBase64Url();
  const nonce = randomBase64Url();
  const verifier = randomBase64Url(48);
  const challenge = await sha256Base64Url(verifier);
  const returnTo = safeReturnTo(requestUrl.searchParams.get('return_to'));
  const authorizationUrl = new URL(
    'https://accounts.google.com/o/oauth2/v2/auth',
  );
  authorizationUrl.search = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: env.GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  }).toString();

  const headers = new Headers({
    Location: authorizationUrl.toString(),
    'Cache-Control': 'no-store',
  });
  const cookieOptions = {
    maxAge: 600,
    secure: new URL(env.APP_ORIGIN).protocol === 'https:',
  };
  headers.append(
    'Set-Cookie',
    serializeCookie(OAUTH_STATE_COOKIE, state, cookieOptions),
  );
  headers.append(
    'Set-Cookie',
    serializeCookie(OAUTH_NONCE_COOKIE, nonce, cookieOptions),
  );
  headers.append(
    'Set-Cookie',
    serializeCookie(OAUTH_VERIFIER_COOKIE, verifier, cookieOptions),
  );
  headers.append(
    'Set-Cookie',
    serializeCookie(OAUTH_RETURN_TO_COOKIE, returnTo, cookieOptions),
  );
  return new Response(null, { status: 302, headers });
}
