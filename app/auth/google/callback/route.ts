import { env } from 'cloudflare:workers';
import { createRemoteJWKSet, jwtVerify } from 'jose';

import {
  OAUTH_NONCE_COOKIE,
  OAUTH_RETURN_TO_COOKIE,
  OAUTH_STATE_COOKIE,
  OAUTH_VERIFIER_COOKIE,
  DEV_SESSION_COOKIE,
  parseCookies,
  randomBase64Url,
  safeReturnTo,
  serializeCookie,
  SESSION_COOKIE,
} from '@/lib/auth-core';
import {
  createSiteSession,
  findGoogleAccessUser,
  getAuthMode,
} from '@/lib/site-auth';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

const googleKeys = createRemoteJWKSet(
  new URL('https://www.googleapis.com/oauth2/v3/certs'),
);

function errorResponse(message: string, status = 400) {
  return new Response(
    `<!doctype html><html><head><meta name="viewport" content="width=device-width"><title>Sign-in error</title></head><body style="font:16px system-ui;margin:10vh auto;max-width:34rem;padding:2rem"><h1>Sign-in unavailable</h1><p>${message}</p><p><a href="/">Return home</a></p></body></html>`,
    {
      status,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    },
  );
}

function clearTransientCookies(headers: Headers) {
  for (const name of [
    OAUTH_STATE_COOKIE,
    OAUTH_NONCE_COOKIE,
    OAUTH_VERIFIER_COOKIE,
    OAUTH_RETURN_TO_COOKIE,
  ]) {
    headers.append('Set-Cookie', serializeCookie(name, '', { maxAge: 0 }));
  }
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
    return errorResponse('Google sign-in has not been configured.', 503);
  }
  const requestUrl = new URL(request.url);
  const cookies = parseCookies(request.headers.get('cookie'));
  const state = requestUrl.searchParams.get('state');
  const code = requestUrl.searchParams.get('code');
  const expectedState = cookies.get(OAUTH_STATE_COOKIE);
  const nonce = cookies.get(OAUTH_NONCE_COOKIE);
  const verifier = cookies.get(OAUTH_VERIFIER_COOKIE);
  if (
    !state ||
    !code ||
    !expectedState ||
    state !== expectedState ||
    !nonce ||
    !verifier
  ) {
    return errorResponse(
      'The sign-in request expired or could not be verified.',
    );
  }

  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: env.GOOGLE_REDIRECT_URI,
      grant_type: 'authorization_code',
      code_verifier: verifier,
    }),
  });
  if (!tokenResponse.ok) {
    return errorResponse('Google did not accept the sign-in request.');
  }
  const tokens = (await tokenResponse.json()) as { id_token?: string };
  if (!tokens.id_token)
    return errorResponse('Google did not return an identity token.');

  try {
    const { payload } = await jwtVerify(tokens.id_token, googleKeys, {
      audience: env.GOOGLE_CLIENT_ID,
      issuer: ['https://accounts.google.com', 'accounts.google.com'],
      algorithms: ['RS256'],
    });
    if (
      payload.nonce !== nonce ||
      payload.email_verified !== true ||
      typeof payload.sub !== 'string' ||
      typeof payload.email !== 'string'
    ) {
      return errorResponse('The Google identity could not be verified.');
    }
    const user = await findGoogleAccessUser({
      subject: payload.sub,
      email: payload.email,
      displayName: typeof payload.name === 'string' ? payload.name : null,
    });
    if (!user) {
      return errorResponse(
        'This Google account is not allowed to view surmyi.',
        403,
      );
    }
    const rawSession = randomBase64Url(32);
    await createSiteSession(user.id, rawSession);
    const returnTo = safeReturnTo(cookies.get(OAUTH_RETURN_TO_COOKIE));
    const destination = new URL(returnTo, env.APP_ORIGIN);
    const secure = destination.protocol === 'https:';
    const sessionCookie = secure ? SESSION_COOKIE : DEV_SESSION_COOKIE;
    const headers = new Headers({
      Location: destination.toString(),
      'Cache-Control': 'no-store',
    });
    headers.append(
      'Set-Cookie',
      serializeCookie(sessionCookie, rawSession, {
        maxAge: 12 * 60 * 60,
        secure,
      }),
    );
    clearTransientCookies(headers);
    return new Response(null, { status: 302, headers });
  } catch {
    return errorResponse('The Google identity token was invalid or expired.');
  }
}
