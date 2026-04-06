import test from 'node:test';
import assert from 'node:assert/strict';

import { setupKnowledgeRoutes } from '../../src/routes/knowledge.js';

function createFakeRouter() {
  const routes = new Map();

  return {
    routes,
    get(path, handler) {
      routes.set(`GET ${path}`, handler);
    },
    post(path, handler) {
      routes.set(`POST ${path}`, handler);
    },
  };
}

function createFakeResponse() {
  return {
    statusCode: 200,
    payload: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.payload = body;
      return this;
    },
  };
}

test('setupKnowledgeRoutes forwards the request body to maintainAiWikiEntry', async () => {
  const router = createFakeRouter();
  const requestBody = {
    title: '2026-04-05 睡眠与学习方法',
    content: '我这周睡眠不足，但建议先固定起床时间。',
    date: '2026-04-05',
  };
  const calls = [];
  const client = {
    knowledgeCli: {
      async maintainAiWikiEntry(payload) {
        calls.push(payload);
        return {
          classification: { type: 'mixed' },
        };
      },
    },
  };

  setupKnowledgeRoutes(router, client);

  const handler = router.routes.get('POST /feishu/knowledge/user/maintain-ai-wiki');
  assert.equal(typeof handler, 'function');

  const res = createFakeResponse();
  let nextError;

  await handler({ body: requestBody }, res, (error) => {
    nextError = error;
  });

  assert.deepEqual(calls, [requestBody]);
  assert.equal(nextError, undefined);
});

test('setupKnowledgeRoutes responds with ok=true and the service result for maintainAiWikiEntry', async () => {
  const router = createFakeRouter();
  const serviceResult = {
    classification: { type: 'personal' },
    pages: {
      personal: {
        canonicalNodeToken: 'doc_personal_canonical_node',
      },
    },
    maintenance: {
      indexUpdated: true,
      timelineUpdated: true,
    },
  };
  const client = {
    knowledgeCli: {
      async maintainAiWikiEntry() {
        return serviceResult;
      },
    },
  };

  setupKnowledgeRoutes(router, client);

  const handler = router.routes.get('POST /feishu/knowledge/user/maintain-ai-wiki');
  const res = createFakeResponse();

  await handler({ body: { title: '睡眠记录' } }, res, () => {});

  assert.deepEqual(res.payload, {
    ok: true,
    ...serviceResult,
  });
});

test('setupKnowledgeRoutes passes maintainAiWikiEntry errors to next without writing a response', async () => {
  const router = createFakeRouter();
  const error = new Error('maintain failed');
  const client = {
    knowledgeCli: {
      async maintainAiWikiEntry() {
        throw error;
      },
    },
  };

  setupKnowledgeRoutes(router, client);

  const handler = router.routes.get('POST /feishu/knowledge/user/maintain-ai-wiki');
  const res = createFakeResponse();
  const nextCalls = [];

  await handler({ body: { title: '睡眠记录' } }, res, (nextError) => {
    nextCalls.push(nextError);
  });

  assert.deepEqual(nextCalls, [error]);
  assert.equal(res.payload, undefined);
});

test('setupKnowledgeRoutes forwards the request body to maintainAiWikiFromJournals', async () => {
  const router = createFakeRouter();
  const requestBody = {
    limit: 5,
    since: '2026-04-01',
  };
  const calls = [];
  const client = {
    knowledgeCli: {
      async maintainAiWikiFromJournals(payload) {
        calls.push(payload);
        return {
          summary: {
            processedCount: 1,
          },
        };
      },
    },
  };

  setupKnowledgeRoutes(router, client);

  const handler = router.routes.get('POST /feishu/knowledge/user/maintain-ai-wiki/journals');
  assert.equal(typeof handler, 'function');

  const res = createFakeResponse();
  let nextError;

  await handler({ body: requestBody }, res, (error) => {
    nextError = error;
  });

  assert.deepEqual(calls, [requestBody]);
  assert.equal(nextError, undefined);
  assert.deepEqual(res.payload, {
    ok: true,
    summary: {
      processedCount: 1,
    },
  });
});
