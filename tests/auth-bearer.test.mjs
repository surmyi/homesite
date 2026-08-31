import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseCookies,
  safeReturnTo,
  sha256Hex,
  verifyBearerToken,
} from '../lib/auth-core.ts';

test('finance bearer accepts the token whose hash is configured', async () => {
  const token = 'finance-test-token-with-sufficient-entropy';
  const expected = await sha256Hex(token);
  assert.deepEqual(await verifyBearerToken(`Bearer ${token}`, expected), {
    ok: true,
  });
});

test('finance bearer rejects missing, malformed, and incorrect credentials', async () => {
  const expected = await sha256Hex('correct-token');
  assert.deepEqual(await verifyBearerToken(null, expected), {
    ok: false,
    reason: 'missing',
  });
  assert.deepEqual(await verifyBearerToken('Basic nope', expected), {
    ok: false,
    reason: 'missing',
  });
  assert.deepEqual(await verifyBearerToken('Bearer wrong-token', expected), {
    ok: false,
    reason: 'invalid',
  });
});

test('finance bearer fails closed when the server secret is absent or malformed', async () => {
  assert.deepEqual(await verifyBearerToken('Bearer token', undefined), {
    ok: false,
    reason: 'not_configured',
  });
  assert.deepEqual(await verifyBearerToken('Bearer token', 'not-a-hash'), {
    ok: false,
    reason: 'not_configured',
  });
});

test('cookie parsing ignores hostile percent encoding', () => {
  assert.deepEqual(
    Object.fromEntries(parseCookies('good=value; broken=%E0%A4%A; next=ok')),
    { good: 'value', next: 'ok' },
  );
});

test('OAuth return paths stay on-site and avoid authentication loops', () => {
  assert.equal(safeReturnTo('/#finance'), '/#finance');
  assert.equal(safeReturnTo('https://evil.example/'), '/');
  assert.equal(safeReturnTo('//evil.example/'), '/');
  assert.equal(safeReturnTo('/auth/google/start'), '/');
});
