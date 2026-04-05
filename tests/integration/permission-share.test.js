/**
 * Integration test: Permission sharing
 *
 * Feishu permission APIs:
 *   - Add member:    POST /open-apis/drive/v2/permissions/{token}/members
 *   - List members:  GET  /open-apis/drive/v2/permissions/{token}/members
 *   - Remove member: DELETE /open-apis/drive/v2/permissions/{token}/members/{member_id}
 *   - Public link:   POST /open-apis/drive/v2/permissions/{token}/public/settings
 *
 * Note: {token} is the document's `obj_token`, type is "docx".
 * These endpoints require user_access_token — tenant token returns 403.
 *
 * Verifies:
 *   1. Sharing a doc with a user via user_access_token succeeds
 *   2. Shared member appears in member list
 *   3. Removing the member succeeds
 *   4. Attempting to share with tenant_access_token is rejected
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

for (const name of ['.env.test.local', '.env.test']) {
  try {
    const lines = readFileSync(resolve(__dirname, '../../', name), 'utf8').split('\n');
    for (const line of lines) {
      const [key, ...rest] = line.split('=');
      if (key && !key.startsWith('#') && rest.length && !process.env[key.trim()]) {
        process.env[key.trim()] = rest.join('=').trim();
      }
    }
  } catch { /* ignore */ }
}

const APP_ID            = process.env.FEISHU_APP_ID;
const APP_SECRET        = process.env.FEISHU_APP_SECRET;
const USER_ACCESS_TOKEN = process.env.FEISHU_USER_ACCESS_TOKEN;
const TEST_USER_OPEN_ID = process.env.FEISHU_TEST_USER_OPEN_ID;

if (!APP_ID || !APP_SECRET) {
  console.error('SKIP: FEISHU_APP_ID and FEISHU_APP_SECRET must be set');
  process.exit(0);
}

import { FeishuClient } from '../../src/index.js';

const client = new FeishuClient({ appId: APP_ID, appSecret: APP_SECRET });

// Permission APIs require user_access_token
function permRequest(method, path, data) {
  if (!USER_ACCESS_TOKEN) throw new Error('FEISHU_USER_ACCESS_TOKEN not set');
  return client.http.request({
    method,
    url: path,
    data,
    headers: { Authorization: `Bearer ${USER_ACCESS_TOKEN}` },
  });
}

// Track docs created during tests for cleanup
const cleanupDocs = [];

after(async () => {
  for (const docId of cleanupDocs) {
    try { await client.doc.deleteDocument(docId); } catch { /* ignore */ }
  }
});

// Helper: create a test document owned by the user
async function createUserDoc(label) {
  const result = await client.http.request({
    method: 'POST',
    url: '/open-apis/docx/v1/documents',
    data: { title: `[TEST] ${label} ${Date.now()}`, type: 'doc' },
    headers: { Authorization: `Bearer ${USER_ACCESS_TOKEN}` },
  });
  const docId    = result?.data?.document_id;
  const objToken = result?.data?.obj_token ?? docId;  // Feishu uses obj_token for perm APIs
  assert.ok(docId, 'setup: document_id must be present');
  cleanupDocs.push(docId);
  return { docId, objToken };
}

if (!USER_ACCESS_TOKEN || !TEST_USER_OPEN_ID) {
  test('permission sharing tests — SKIPPED', async () => {
    console.log('  ⚠ Skipped: set FEISHU_USER_ACCESS_TOKEN and FEISHU_TEST_USER_OPEN_ID to enable');
  });
} else {
  test('1. share document with a user (view permission)', async () => {
    const { objToken } = await createUserDoc('perm-share');

    const result = await permRequest(
      'POST',
      `/open-apis/drive/v2/permissions/${encodeURIComponent(objToken)}/members`,
      {
        type:             'user',
        id:               TEST_USER_OPEN_ID,
        role:             'view',
        perm_type:        'container',
        notify_lark:      false,
      }
    );

    // Feishu returns code 0 on success
    const code = result?.raw?.code ?? result?.code;
    assert.equal(code, 0, `expected code 0, got ${code}: ${result?.raw?.msg}`);
  });

  test('2. shared member appears in member list', async () => {
    const { objToken } = await createUserDoc('perm-list');

    // Add the user first
    await permRequest(
      'POST',
      `/open-apis/drive/v2/permissions/${encodeURIComponent(objToken)}/members`,
      { type: 'user', id: TEST_USER_OPEN_ID, role: 'view', perm_type: 'container', notify_lark: false }
    );

    // Fetch member list
    const list = await permRequest(
      'GET',
      `/open-apis/drive/v2/permissions/${encodeURIComponent(objToken)}/members?type=docx`
    );

    const members = list?.data?.members ?? [];
    const found = members.some(
      (m) => m.member_id === TEST_USER_OPEN_ID || m.open_id === TEST_USER_OPEN_ID
    );
    assert.ok(found, `user ${TEST_USER_OPEN_ID} should appear in member list`);
  });

  test('3. remove member revokes access', async () => {
    const { objToken } = await createUserDoc('perm-remove');

    // Add
    await permRequest(
      'POST',
      `/open-apis/drive/v2/permissions/${encodeURIComponent(objToken)}/members`,
      { type: 'user', id: TEST_USER_OPEN_ID, role: 'view', perm_type: 'container', notify_lark: false }
    );

    // Remove
    const del = await permRequest(
      'DELETE',
      `/open-apis/drive/v2/permissions/${encodeURIComponent(objToken)}/members/${encodeURIComponent(TEST_USER_OPEN_ID)}?type=docx&member_type=openid`
    );
    const code = del?.raw?.code ?? del?.code;
    assert.equal(code, 0, `remove member should return code 0, got ${code}`);

    // Verify removed
    const list = await permRequest(
      'GET',
      `/open-apis/drive/v2/permissions/${encodeURIComponent(objToken)}/members?type=docx`
    );
    const members = list?.data?.members ?? [];
    const stillThere = members.some(
      (m) => m.member_id === TEST_USER_OPEN_ID || m.open_id === TEST_USER_OPEN_ID
    );
    assert.ok(!stillThere, 'user should no longer appear in member list after removal');
  });

  test('4. sharing with tenant_access_token is rejected (403 or permission error)', async () => {
    await client.ensureTenantToken();
    const { objToken } = await createUserDoc('perm-tenant-reject');

    await assert.rejects(
      () => client.post(
        `/open-apis/drive/v2/permissions/${encodeURIComponent(objToken)}/members`,
        { type: 'user', id: TEST_USER_OPEN_ID, role: 'view', perm_type: 'container', notify_lark: false }
      ),
      (err) => {
        const code = err.code ?? err.statusCode;
        const msg  = (err.message ?? '').toLowerCase();
        const isPermError =
          code === 403 ||
          (typeof code === 'number' && code >= 230000 && code < 231000) ||
          msg.includes('permission') ||
          msg.includes('forbidden') ||
          msg.includes('unauthorized');
        assert.ok(isPermError, `expected permission error, got code=${code} msg=${err.message}`);
        return true;
      }
    );
  });
}
