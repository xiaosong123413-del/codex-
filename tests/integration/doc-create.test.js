/**
 * Integration test: Document creation with user_access_token
 *
 * Why user_access_token matters:
 *   Documents created with tenant_access_token are owned by the app bot and
 *   are NOT visible in the user's personal drive. Only user_access_token
 *   produces a document the user can actually open.
 *
 * Verifies:
 *   1. Document creation with tenant_access_token succeeds (bot-owned)
 *   2. Document creation with user_access_token succeeds (user-visible)
 *   3. Created document is retrievable and has correct title
 *   4. Cleanup: delete test documents after each test
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load env files (local overrides first, then .env.test fallback)
for (const name of ['.env.test.local', '.env.test']) {
  try {
    const lines = readFileSync(resolve(__dirname, '../../', name), 'utf8').split('\n');
    for (const line of lines) {
      const [key, ...rest] = line.split('=');
      if (key && !key.startsWith('#') && rest.length && !process.env[key.trim()]) {
        process.env[key.trim()] = rest.join('=').trim();
      }
    }
  } catch { /* ignore missing files */ }
}

const APP_ID             = process.env.FEISHU_APP_ID;
const APP_SECRET         = process.env.FEISHU_APP_SECRET;
const USER_ACCESS_TOKEN  = process.env.FEISHU_USER_ACCESS_TOKEN;

if (!APP_ID || !APP_SECRET) {
  console.error('SKIP: FEISHU_APP_ID and FEISHU_APP_SECRET must be set');
  process.exit(0);
}

import { FeishuClient } from '../../src/index.js';

// Helper: create a client that overrides the Authorization header with a
// user_access_token for a single request, without altering the main client.
function withUserToken(client, userToken) {
  return {
    post: (url, data) =>
      client.http.request({
        method: 'POST',
        url,
        data,
        headers: { Authorization: `Bearer ${userToken}` },
      }),
    get: (url) =>
      client.http.request({
        method: 'GET',
        url,
        headers: { Authorization: `Bearer ${userToken}` },
      }),
    delete: (url) =>
      client.http.request({
        method: 'DELETE',
        url,
        headers: { Authorization: `Bearer ${userToken}` },
      }),
  };
}

const client = new FeishuClient({ appId: APP_ID, appSecret: APP_SECRET });
const createdDocIds = [];   // track for cleanup

after(async () => {
  // Best-effort cleanup — delete all documents created during tests
  for (const docId of createdDocIds) {
    try { await client.doc.deleteDocument(docId); } catch { /* ignore */ }
  }
});

// ─── Test 1: tenant_access_token ────────────────────────────────────────────

test('1. create document with tenant_access_token (bot-owned)', async () => {
  await client.ensureTenantToken();

  const title = `[TEST] tenant doc ${Date.now()}`;
  const result = await client.doc.createDocument(title, 'doc');

  assert.ok(result, 'result should exist');
  const docId = result?.data?.document?.document_id ?? result?.data?.document_id ?? result?.document_id;
  assert.ok(docId, 'document_id must be present in response');
  createdDocIds.push(docId);

  // Retrieve and verify title
  const fetched = await client.doc.getDocument(docId);
  const fetchedTitle = fetched?.data?.document?.title ?? fetched?.data?.title ?? fetched?.title;
  assert.equal(fetchedTitle, title, 'retrieved title must match what was set');
});

// ─── Test 2 & 3: user_access_token ──────────────────────────────────────────

if (USER_ACCESS_TOKEN) {
  test('2. create document with user_access_token (user-visible)', async () => {
    const userClient = withUserToken(client, USER_ACCESS_TOKEN);

    const title = `[TEST] user doc ${Date.now()}`;
    const result = await userClient.post('/open-apis/docx/v1/documents', {
      title,
      type: 'doc',
    });

    assert.ok(result?.data?.document_id, 'document_id must be present');
    const docId = result.data.document_id;
    createdDocIds.push(docId);

    // Verify retrieval with user token
    const fetched = await userClient.get(`/open-apis/docx/v1/documents/${encodeURIComponent(docId)}`);
    const fetchedTitle = fetched?.data?.title ?? fetched?.title;
    assert.equal(fetchedTitle, title, 'user-created doc title must match');
  });

  test('3. user_access_token document is NOT accessible with tenant token', async () => {
    // Create with user token
    const userClient = withUserToken(client, USER_ACCESS_TOKEN);
    const title = `[TEST] user-only doc ${Date.now()}`;
    const result = await userClient.post('/open-apis/docx/v1/documents', {
      title,
      type: 'doc',
    });
    const docId = result?.data?.document_id;
    assert.ok(docId, 'document_id must be present');
    createdDocIds.push(docId);

    // Tenant token fetch should fail (403 or Feishu permission error code)
    await client.ensureTenantToken();
    await assert.rejects(
      () => client.doc.getDocument(docId),
      (err) => {
        // Accept either an HTTP 403 or a Feishu permission error code
        const code = err.code ?? err.statusCode;
        const msg  = err.message ?? '';
        const isPermissionError =
          code === 403 ||
          (typeof code === 'number' && code >= 230000 && code < 231000) ||
          msg.toLowerCase().includes('permission') ||
          msg.toLowerCase().includes('forbidden');
        assert.ok(
          isPermissionError,
          `expected a permission error, got: code=${code} msg=${msg}`
        );
        return true;
      }
    );
  });
} else {
  test('2 & 3. user_access_token tests — SKIPPED (set FEISHU_USER_ACCESS_TOKEN to enable)', async () => {
    console.log('  ⚠ Skipped: FEISHU_USER_ACCESS_TOKEN not set');
  });
}
