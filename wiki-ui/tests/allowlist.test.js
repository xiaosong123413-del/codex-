import test from 'node:test';
import assert from 'node:assert/strict';

import { isAllowedEmail } from '../lib/auth/allowlist.ts';

test('isAllowedEmail returns true only for exact allowlisted emails', () => {
  process.env.ALLOWED_GOOGLE_EMAILS = 'a@example.com,b@example.com';

  assert.equal(isAllowedEmail('a@example.com'), true);
  assert.equal(isAllowedEmail('b@example.com'), true);
  assert.equal(isAllowedEmail('c@example.com'), false);
  assert.equal(isAllowedEmail(null), false);
});
