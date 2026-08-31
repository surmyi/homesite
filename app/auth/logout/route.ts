import { env } from 'cloudflare:workers';

import {
  DEV_SESSION_COOKIE,
  parseCookies,
  serializeCookie,
  SESSION_COOKIE,
} from '@/lib/auth-core';
import { getAuthMode, revokeSiteSession } from '@/lib/site-auth';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  if (getAuthMode() !== 'google') {
    const returnTo = encodeURIComponent('/');
    return Response.redirect(
      new URL(`/signout-with-chatgpt?return_to=${returnTo}`, request.url),
      302,
    );
  }
  const cookies = parseCookies(request.headers.get('cookie'));
  await revokeSiteSession(
    cookies.get(SESSION_COOKIE) ?? cookies.get(DEV_SESSION_COOKIE),
  );
  const destination = env.APP_ORIGIN
    ? new URL('/', env.APP_ORIGIN)
    : new URL('/', request.url);
  const headers = new Headers({
    Location: destination.toString(),
    'Cache-Control': 'no-store',
  });
  headers.append(
    'Set-Cookie',
    serializeCookie(SESSION_COOKIE, '', { maxAge: 0 }),
  );
  headers.append(
    'Set-Cookie',
    serializeCookie(DEV_SESSION_COOKIE, '', { maxAge: 0, secure: false }),
  );
  return new Response(null, { status: 302, headers });
}
