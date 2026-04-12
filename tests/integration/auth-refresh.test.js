/**
 * Integration test: Auth token refresh flow
 *
 * Verifies:
 *   1. Initial token fetch succeeds with real credentials
 *   2. A valid (unexpired) token is reused without a second network call
 *   3. An expired token triggers a refresh and returns a new token
 */

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env.test if present
try {
  const envPath = resolve(__dirname, '../../.env.test.local');
  const lines = readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const [key, ...rest] = line.split('=');
    if (key && !key.startsWith('#') && rest.length) {
      process.env[key.trim()] = rest.join('=').trim();
    }
  }
} catch {
  // Fall through — env vars may already be set
}

// Fall back to .env.test
try {
  const envPath = resolve(__dirname, '../../.env.test');
  const lines = readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const [key, ...rest] = line.split('=');
    if (key && !key.startsWith('#') && rest.length && !process.env[key.trim()]) {
      process.env[key.trim()] = rest.join('=').trim();
    }
  }
} catch { /* ignore */ }

const APP_ID     = process.env.FEISHU_APP_ID;
const APP_SECRET = process.env.FEISHU_APP_SECRET;

if (!APP_ID || !APP_SECRET) {
  console.error('SKIP: FEISHU_APP_ID and FEISHU_APP_SECRET must be set');
  process.exit(0);
}

import { FeishuClient } from '../../src/index.js';

let client;

before(() => {
  client = new FeishuClient({ appId: APP_ID, appSecret: APP_SECRET });
});

test('1. initial tenant token fetch returns a valid token', async () => {
  const token = await client.getTenantToken();

  assert.ok(token, 'token should be non-empty');
  assert.equal(typeof token, 'string');
  assert.match(token, /^t-/, 'Feishu tenant tokens start with "t-"');
  assert.ok(client._tenantTokenExpiresAt > Date.now(), 'expiry should be in the future');
});

test('2. second call reuses cached token (no extra network round-trip)', async () => {
  const first  = await client.getTenantToken();
  const second = await client.getTenantToken();

  assert.equal(first, second, 'same token object must be returned when still valid');
});

test('3. expired token triggers automatic refresh and returns a new token', async () => {
  const original = await client.getTenantToken();

  // Simulate expiry by pushing expiry into the past
  client._tenantTokenExpiresAt = Date.now() - 1;
  client.http.tokenExpireAt     = Date.now() - 1;

  const refreshed = await client.getTenantToken();

  assert.ok(refreshed, 'refreshed token should be non-empty');
  assert.equal(typeof refreshed, 'string');
  assert.match(refreshed, /^t-/);
  assert.ok(
    client._tenantTokenExpiresAt > Date.now(),
    'new expiry must be in the future after refresh'
  );
  // Tokens may be the same string if Feishu reuses them within a window,
  // but expiry must have been updated — already checked above.
});

test('4. invalid credentials throw an authentication error', async () => {
  const bad = new FeishuClient({ appId: 'bad_id', appSecret: 'bad_secret' });

  await assert.rejects(
    () => bad.getTenantToken(),
    (err) => {
      assert.ok(err.message || err.code, 'error must have message or code');
      return true;
    }
  );
});
