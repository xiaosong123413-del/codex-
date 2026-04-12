import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CliBaseStore,
  KnowledgeCliService,
  LarkCliRunner,
} from '../../src/services/knowledgeCli.js';

function createRunnerWithResponses(sequence) {
  const calls = [];
  let index = 0;

  return {
    calls,
    async runJson(args) {
      calls.push(args);
      const step = sequence[index++];

      if (!step) {
        throw new Error(`Unexpected call: ${args.join(' ')}`);
      }

      if (step.assert) {
        step.assert(args);
      }

      return step.response;
    },
  };
}

test('CliBaseStore.upsertRecord 命中唯一键时会更新原记录而不是重复创建', async () => {
  const runner = createRunnerWithResponses([
    {
      response: {
        ok: true,
        data: {
          fields: ['node_id', 'title'],
          data: [['personal:ubuntu', 'Ubuntu']],
          record_id_list: ['rec_existing_1'],
          has_more: false,
        },
      },
    },
    {
      assert(args) {
        assert.equal(args[0], 'base');
        assert.equal(args[1], '+record-upsert');
        assert.ok(args.includes('--record-id'));
        assert.ok(args.includes('rec_existing_1'));
      },
      response: {
        ok: true,
        data: {
          updated: true,
          record: {
            record_id: 'rec_existing_1',
          },
        },
      },
    },
  ]);

  const store = new CliBaseStore({
    runner,
    baseToken: 'base_1',
  });

  const result = await store.upsertRecord({
    tableName: 'Nodes',
    uniqueField: 'node_id',
    fields: {
      node_id: 'personal:ubuntu',
      title: 'Ubuntu 新版',
    },
  });

  assert.equal(result.recordId, 'rec_existing_1');
  assert.equal(result.operation, 'update');
});

test('LarkCliRunner builds a Windows-safe invocation', () => {
  const runner = new LarkCliRunner();
  const invocation = runner.buildInvocation(['auth', 'status']);

  if (process.platform === 'win32') {
    assert.match(invocation.file, /node(?:\.exe)?$/i);
    assert.match(invocation.args[0], /node_modules[\\/]+@larksuite[\\/]+cli[\\/]+scripts[\\/]+run\.js$/i);
    assert.deepEqual(invocation.args.slice(1), ['auth', 'status']);
    return;
  }

  assert.equal(invocation.file, 'lark-cli');
  assert.deepEqual(invocation.args, ['auth', 'status']);
});

test('KnowledgeCliService.importNodeWithPublish 会导入个人页并创建 AI 整理页', async () => {
  const runner = createRunnerWithResponses([
    {
      response: {
        code: 0,
        data: {
          node: {
            space_id: 'space_1',
            node_token: 'Loq0wNDYDiwKrekMCY9cmqBLnPc',
            parent_node_token: 'RXpEwqKHEiQpUCk5AhZcP33Jnjf',
            obj_token: 'Q2EvdYIpCosV7BxWxc5cZpCZnVh',
            obj_type: 'docx',
            title: 'Ubuntu',
            has_child: false,
          },
        },
      },
    },
    {
      response: {
        code: 0,
        data: {
          content: 'Ubuntu\n问题汇总\n没有Linux环境\n下载Linux内核更新包\n再次点击ubuntu，输入密码\n',
        },
      },
    },
    {
      response: {
        ok: true,
        data: {
          fields: ['node_id', 'obj_token', 'source_url'],
          data: [],
          record_id_list: [],
          has_more: false,
        },
      },
    },
    {
      assert(args) {
        assert.equal(args[0], 'docs');
        assert.equal(args[1], '+create');
        assert.ok(args.includes('--wiki-space'));
        assert.ok(args.includes('my_library'));
      },
      response: {
        ok: true,
        data: {
          doc_id: 'doc_ai_1',
          doc_url: 'https://example.com/wiki/ai-ubuntu',
        },
      },
    },
    { response: { ok: true, data: { fields: ['node_id'], data: [], record_id_list: [], has_more: false } } },
    { response: { ok: true, data: { created: true, record: { record_id: 'rec_nodes_1' } } } },
    { response: { ok: true, data: { fields: ['node_id'], data: [], record_id_list: [], has_more: false } } },
    { response: { ok: true, data: { created: true, record: { record_id: 'rec_nodes_2' } } } },
    { response: { ok: true, data: { fields: ['node_id'], data: [], record_id_list: [], has_more: false } } },
    { response: { ok: true, data: { created: true, record: { record_id: 'rec_nodes_3' } } } },
    { response: { ok: true, data: { fields: ['node_id'], data: [], record_id_list: [], has_more: false } } },
    { response: { ok: true, data: { created: true, record: { record_id: 'rec_nodes_4' } } } },
    { response: { ok: true, data: { fields: ['edge_id'], data: [], record_id_list: [], has_more: false } } },
    { response: { ok: true, data: { created: true, record: { record_id: 'rec_edges_1' } } } },
    { response: { ok: true, data: { fields: ['edge_id'], data: [], record_id_list: [], has_more: false } } },
    { response: { ok: true, data: { created: true, record: { record_id: 'rec_edges_2' } } } },
    { response: { ok: true, data: { fields: ['edge_id'], data: [], record_id_list: [], has_more: false } } },
    { response: { ok: true, data: { created: true, record: { record_id: 'rec_edges_3' } } } },
    { response: { ok: true, data: { fields: ['source_id'], data: [], record_id_list: [], has_more: false } } },
    { response: { ok: true, data: { created: true, record: { record_id: 'rec_sources_1' } } } },
    { response: { ok: true, data: { fields: ['source_id'], data: [], record_id_list: [], has_more: false } } },
    { response: { ok: true, data: { created: true, record: { record_id: 'rec_sources_2' } } } },
    { response: { ok: true, data: { fields: ['source_id'], data: [], record_id_list: [], has_more: false } } },
    { response: { ok: true, data: { created: true, record: { record_id: 'rec_sources_3' } } } },
    { response: { ok: true, data: { fields: ['mapping_id'], data: [], record_id_list: [], has_more: false } } },
    { response: { ok: true, data: { created: true, record: { record_id: 'rec_mappings_1' } } } },
    { response: { ok: true, data: { fields: ['job_id'], data: [], record_id_list: [], has_more: false } } },
    { response: { ok: true, data: { created: true, record: { record_id: 'rec_jobs_1' } } } },
  ]);

  const service = new KnowledgeCliService({
    runner,
    baseToken: 'base_1',
  });

  const result = await service.importNodeWithPublish({
    nodeToken: 'Loq0wNDYDiwKrekMCY9cmqBLnPc',
    aiWikiSpace: 'my_library',
  });

  assert.equal(result.node.title, 'Ubuntu');
  assert.equal(result.aiPage.docId, 'doc_ai_1');
  assert.equal(result.imported.nodes, 4);
  assert.equal(result.imported.edges, 3);
  assert.equal(result.imported.sources, 3);
  assert.equal(result.imported.mappings, 1);
  assert.equal(result.imported.jobs, 1);
});
