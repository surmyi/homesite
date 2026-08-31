export const SESSION_COOKIE = '__Host-surmyi_session';
export const DEV_SESSION_COOKIE = 'surmyi_session';
export const OAUTH_STATE_COOKIE = 'surmyi_oauth_state';
export const OAUTH_NONCE_COOKIE = 'surmyi_oauth_nonce';
export const OAUTH_VERIFIER_COOKIE = 'surmyi_oauth_verifier';
export const OAUTH_RETURN_TO_COOKIE = 'surmyi_oauth_return_to';

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

export async function sha256Base64Url(value: string) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  let binary = '';
  for (const byte of new Uint8Array(digest))
    binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/g, '');
}

function constantTimeEqual(left: string, right: string) {
  const length = Math.max(left.length, right.length);
  let mismatch = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    mismatch |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return mismatch === 0;
}

export async function verifyBearerToken(
  authorization: string | null,
  expectedSha256: string | undefined,
) {
  if (!expectedSha256 || !/^[a-f0-9]{64}$/i.test(expectedSha256)) {
    return { ok: false as const, reason: 'not_configured' as const };
  }
  const match = authorization?.match(/^Bearer\s+([^\s]+)$/i);
  if (!match) return { ok: false as const, reason: 'missing' as const };
  const actual = await sha256Hex(match[1]);
  return constantTimeEqual(actual, expectedSha256.toLowerCase())
    ? { ok: true as const }
    : { ok: false as const, reason: 'invalid' as const };
}

export function parseCookies(header: string | null) {
  const result = new Map<string, string>();
  for (const pair of header?.split(';') ?? []) {
    const separator = pair.indexOf('=');
    if (separator < 0) continue;
    const key = pair.slice(0, separator).trim();
    const value = pair.slice(separator + 1).trim();
    if (!key) continue;
    try {
      result.set(key, decodeURIComponent(value));
    } catch {
      // Ignore malformed cookies rather than failing the entire request.
    }
  }
  return result;
}

export function serializeCookie(
  name: string,
  value: string,
  options: {
    maxAge?: number;
    secure?: boolean;
    httpOnly?: boolean;
    sameSite?: 'Lax' | 'Strict';
    path?: string;
  } = {},
) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`);
  parts.push(`Path=${options.path ?? '/'}`);
  if (options.httpOnly !== false) parts.push('HttpOnly');
  if (options.secure !== false) parts.push('Secure');
  parts.push(`SameSite=${options.sameSite ?? 'Lax'}`);
  return parts.join('; ');
}

export function randomBase64Url(byteLength = 32) {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/g, '');
}

export function safeReturnTo(value: string | null | undefined) {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/';
  try {
    const parsed = new URL(value, 'https://return-to.invalid');
    if (parsed.origin !== 'https://return-to.invalid') return '/';
    if (parsed.pathname.startsWith('/auth/google/')) return '/';
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return '/';
  }
}
