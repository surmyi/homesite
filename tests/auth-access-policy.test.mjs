import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isOwnAccessRecord,
  wouldRevokeOwnAdminAccess,
} from '../lib/access-policy.ts';

const activeAdmin = {
  email: 'admin@example.com',
  role: 'admin',
  status: 'active',
};

test('an administrator cannot disable their own access', () => {
  assert.equal(
    wouldRevokeOwnAdminAccess('user-1', 'user-1', activeAdmin, {
      ...activeAdmin,
      status: 'disabled',
    }),
    true,
  );
});

test('an administrator cannot demote or re-key their own access', () => {
  assert.equal(
    wouldRevokeOwnAdminAccess('user-1', 'user-1', activeAdmin, {
      ...activeAdmin,
      role: 'viewer',
    }),
    true,
  );
  assert.equal(
    wouldRevokeOwnAdminAccess('user-1', 'user-1', activeAdmin, {
      ...activeAdmin,
      email: 'other@example.com',
    }),
    true,
  );
});

test('self display-name edits and changes to another user remain allowed', () => {
  assert.equal(
    wouldRevokeOwnAdminAccess('user-1', 'user-1', activeAdmin, activeAdmin),
    false,
  );
  assert.equal(
    wouldRevokeOwnAdminAccess('user-1', 'user-2', activeAdmin, {
      ...activeAdmin,
      status: 'disabled',
    }),
    false,
  );
});

test('an administrator cannot target their own record for deletion', () => {
  assert.equal(isOwnAccessRecord('user-1', 'user-1'), true);
  assert.equal(isOwnAccessRecord('user-1', 'user-2'), false);
});
