import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CliBaseStore,
  KnowledgeCliService,
  LarkCliRunner,
} from '../../src/services/knowledgeCli.js';
import { resolveKnowledgeTopics } from '../../src/knowledge/aiWiki.js';

const SLEEP_TOPIC = '\u7761\u7720';
const LEARNING_TOPIC = '\u5b66\u4e60';
const SLEEP_LEARNING_TITLE = `2026-04-05 ${SLEEP_TOPIC}\u4e0e${LEARNING_TOPIC}\u65b9\u6cd5`;
const SLEEP_RECORD_TITLE = `${SLEEP_TOPIC}\u8bb0\u5f55`;
const SLEEP_METHOD_TITLE = `${SLEEP_TOPIC}\u65b9\u6cd5`;
const SLEEP_LEARNING_TEXT = '\u6211\u8fd9\u5468\u7761\u7720\u4e0d\u8db3\uff0c\u4f46\u5efa\u8bae\u5148\u56fa\u5b9a\u8d77\u5e8a\u65f6\u95f4\uff0c\u5b66\u4e60\u6548\u7387\u4f1a\u66f4\u7a33\u5b9a\u3002';
const SLEEP_RECORD_TEXT = '\u6211\u6628\u665a\u4e09\u70b9\u624d\u7761\uff0c\u4eca\u5929\u5f88\u56f0\u3002';
const SLEEP_METHOD_TEXT = '\u5982\u4f55\u56fa\u5b9a\u8d77\u5e8a\u65f6\u95f4\uff0c\u4fdd\u6301\u4f5c\u606f\u7a33\u5b9a\uff0c\u907f\u514d\u70ed\u6baf\u8fc7\u665a\u3002';

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

function createMaintenanceRunner(options = {}) {
  const calls = [];
  const config = {
    personalRootToken: 'Ne9wwI7T0ie8xJkeDnvc6RR9nuh',
    personalRootDocId: 'doc_personal_root',
    personalTopicToken: 'topic_sleep',
    personalTopicTitle: SLEEP_TOPIC,
    personalTopicDocId: 'doc_personal_topic_container',
    personalCanonicalTitle: SLEEP_LEARNING_TITLE,
    personalCanonicalDocId: 'doc_personal_canonical',
    personalCanonicalNodeToken: 'doc_personal_canonical_node',
    personalCanonicalDocUrl: 'https://example.com/docs/personal-canonical',
    personalChildExists: true,
    genericRootToken: 'ZKYew0Ny9imYlYkztATcwJRCnVb',
    genericRootDocId: 'doc_generic_root',
    genericTopicToken: 'topic_sleep_generic',
    genericTopicTitle: SLEEP_TOPIC,
    genericTopicDocId: 'doc_generic_topic_container',
    genericCanonicalTitle: '如何应对睡眠不足带来的学习波动',
    genericCanonicalDocId: 'doc_generic_canonical',
    genericCanonicalNodeToken: 'doc_generic_canonical_node',
    genericCanonicalDocUrl: 'https://example.com/docs/generic-canonical',
    genericChildExists: false,
    shortcutTitle: LEARNING_TOPIC,
    shortcutNodeToken: 'shortcut_learning',
    shortcutOriginNodeToken: 'doc_personal_canonical_node',
    updateDocUrls: {},
    ...options,
  };

  const fixedMarkdown = {
    [config.personalRootDocId]: config.personalRootMarkdown ?? '# 个人信息根页',
    [config.genericRootDocId]: '# 通用信息根页',
    doc_all_pages: config.indexMarkdown ?? '# AI维基百科所有页面链接\n\n## 包含个人信息\n\n- [2026-04-05 睡眠与学习方法](https://example.com/wiki/doc_personal_canonical_old) | 睡眠 | 旧摘要 | 正文\n- [旧快捷页面](https://example.com/wiki/old-shortcut) | 睡眠 | 旧摘要 | 快捷方式\n\n## 不包含个人信息\n\n- 暂无',
    doc_timeline: config.timelineMarkdown ?? '# AI维基百科发展时间线',
    doc_guide: '# AI维基百科维护指南',
    doc_ai_index_root: '# AI维基百科索引根页',
  };

  const maintenanceNodes = {
    [config.personalRootToken]: {
      space_id: 'space_1',
      node_token: config.personalRootToken,
      obj_token: config.personalRootDocId,
      obj_type: 'docx',
      title: '个人信息根页',
    },
    [config.genericRootToken]: {
      space_id: 'space_1',
      node_token: config.genericRootToken,
      obj_token: config.genericRootDocId,
      obj_type: 'docx',
      title: '通用信息根页',
    },
    N1lzwE6UciGFOIkMH3Fcf66Gnkf: {
      space_id: 'space_1',
      node_token: 'N1lzwE6UciGFOIkMH3Fcf66Gnkf',
      obj_token: 'doc_all_pages',
      obj_type: 'docx',
      title: 'AI维基百科所有页面链接',
    },
    Dq9rwWauLiLTxbky1bkch3rPnDb: {
      space_id: 'space_1',
      node_token: 'Dq9rwWauLiLTxbky1bkch3rPnDb',
      obj_token: 'doc_timeline',
      obj_type: 'docx',
      title: 'AI维基百科发展时间线',
    },
    KpEawjD4ViIvmlkdXP0cAcmGn1c: {
      space_id: 'space_1',
      node_token: 'KpEawjD4ViIvmlkdXP0cAcmGn1c',
      obj_token: 'doc_guide',
      obj_type: 'docx',
      title: 'AI维基百科维护指南',
    },
    E2GfwBUPQiGKKFkVDRsc8wtsnUj: {
      space_id: 'space_1',
      node_token: 'E2GfwBUPQiGKKFkVDRsc8wtsnUj',
      obj_token: 'doc_ai_index_root',
      obj_type: 'docx',
      title: 'AI维基百科索引根页',
    },
  };

  const rootChildrenByParent = {
    [config.personalRootToken]: [{
      space_id: 'space_1',
      node_token: config.personalTopicToken,
      obj_token: config.personalTopicDocId,
      obj_type: 'docx',
      title: config.personalTopicTitle,
      node_type: 'origin',
    }, ...(config.personalShortcutExists ? [{
      space_id: 'space_1',
      node_token: config.personalShortcutNodeToken ?? 'shortcut_learning_old',
      obj_token: '',
      obj_type: 'docx',
      title: config.shortcutTitle,
      node_type: 'shortcut',
      origin_node_token: config.personalShortcutOriginNodeToken ?? 'old-canonical-node',
    }] : [])],
    [config.genericRootToken]: [{
      space_id: 'space_1',
      node_token: config.genericTopicToken,
      obj_token: config.genericTopicDocId,
      obj_type: 'docx',
      title: config.genericTopicTitle,
      node_type: 'origin',
    }],
    [config.personalTopicToken]: config.personalChildExists ? [{
      space_id: 'space_1',
      node_token: config.personalCanonicalNodeToken,
      obj_token: config.personalCanonicalDocId,
      obj_type: 'docx',
      title: config.personalCanonicalTitle,
      node_type: 'origin',
    }] : [],
    [config.genericTopicToken]: config.genericChildExists ? [{
      space_id: 'space_1',
      node_token: config.genericCanonicalNodeToken,
      obj_token: config.genericCanonicalDocId,
      obj_type: 'docx',
      title: config.genericCanonicalTitle,
      node_type: 'origin',
    }] : [],
  };

  const valueAfter = (args, flag) => {
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] : '';
  };

  return {
    calls,
    async runJson(args) {
      calls.push(args);

      if (args[0] === 'wiki' && args[1] === 'spaces' && args[2] === 'get_node') {
        const params = JSON.parse(valueAfter(args, '--params'));

        if (params.token === config.personalCanonicalDocId) {
          return {
            code: 0,
            data: {
              node: {
                space_id: 'space_1',
                node_token: config.personalCanonicalNodeToken,
                obj_token: config.personalCanonicalDocId,
                obj_type: 'docx',
                title: config.personalCanonicalTitle,
                node_type: 'origin',
              },
            },
          };
        }

        if (params.token === config.genericCanonicalDocId) {
          return {
            code: 0,
            data: {
              node: {
                space_id: 'space_1',
                node_token: config.genericCanonicalNodeToken,
                obj_token: config.genericCanonicalDocId,
                obj_type: 'docx',
                title: config.genericCanonicalTitle,
                node_type: 'origin',
              },
            },
          };
        }

        return {
          code: 0,
          data: {
            node: maintenanceNodes[params.token] ?? {
              space_id: 'space_1',
              node_token: params.token,
              obj_token: '',
              obj_type: 'docx',
              title: params.token,
              node_type: 'origin',
            },
          },
        };
      }

      if (args[0] === 'docs' && args[1] === '+fetch') {
        const docId = valueAfter(args, '--doc');
        return {
          ok: true,
          data: {
            content: fixedMarkdown[docId] ?? '',
          },
        };
      }

      if (args[0] === 'wiki' && args[1] === 'nodes' && args[2] === 'list') {
        const params = JSON.parse(valueAfter(args, '--params'));
        return {
          code: 0,
          data: {
            items: rootChildrenByParent[params.parent_node_token] ?? [],
          },
        };
      }

      if (args[0] === 'wiki' && args[1] === 'nodes' && args[2] === 'create') {
        const data = JSON.parse(valueAfter(args, '--data'));

        if (data.node_type === 'origin' && data.parent_node_token === config.personalRootToken) {
          return {
            code: 0,
            data: {
              node: {
                space_id: 'space_1',
                node_token: config.personalTopicToken,
                obj_token: config.personalTopicDocId,
                obj_type: 'docx',
                title: data.title,
                node_type: 'origin',
              },
            },
          };
        }

        if (data.node_type === 'origin' && data.parent_node_token === config.genericRootToken) {
          return {
            code: 0,
            data: {
              node: {
                space_id: 'space_1',
                node_token: config.genericTopicToken,
                obj_token: config.genericTopicDocId,
                obj_type: 'docx',
                title: data.title,
                node_type: 'origin',
              },
            },
          };
        }

        if (data.node_type === 'shortcut') {
          const shortcutToken = data.title === config.shortcutTitle
            ? (config.personalShortcutExists ? (config.personalShortcutNodeToken ?? 'shortcut_learning_old') : config.shortcutNodeToken)
            : `shortcut_${String(data.title).trim().replace(/\s+/g, '_') || 'node'}`;
          return {
            code: 0,
            data: {
              node: {
                space_id: 'space_1',
                node_token: shortcutToken,
                obj_token: '',
                obj_type: 'docx',
                title: data.title,
                node_type: 'shortcut',
                origin_node_token: data.origin_node_token,
              },
            },
          };
        }

        throw new Error(`Unexpected wiki create: ${JSON.stringify(data)}`);
      }

      if (args[0] === 'docs' && args[1] === '+create') {
        const title = valueAfter(args, '--title');
        const wikiNode = valueAfter(args, '--wiki-node');

        if (wikiNode === config.personalTopicToken) {
          return {
            ok: true,
            data: {
              doc_id: config.personalCanonicalDocId,
              doc_url: `https://example.com/docs/${config.personalCanonicalDocId}`,
            },
          };
        }

        if (wikiNode === config.genericTopicToken) {
          return {
            ok: true,
            data: {
              doc_id: config.genericCanonicalDocId,
              doc_url: config.genericCanonicalDocUrl,
            },
          };
        }

        throw new Error(`Unexpected docs create: ${args.join(' ')}`);
      }

      if (args[0] === 'docs' && args[1] === '+update') {
        const docId = valueAfter(args, '--doc');

        if (docId === config.personalTopicDocId || docId === config.genericTopicDocId) {
          throw new Error(`Should not update topic container doc: ${docId}`);
        }

        const configuredDocUrl = Object.prototype.hasOwnProperty.call(config.updateDocUrls, docId)
          ? config.updateDocUrls[docId]
          : `https://example.com/wiki/${docId}`;
        const data = {
          doc_id: docId,
        };
        if (configuredDocUrl) {
          data.doc_url = configuredDocUrl;
        }

        return {
          ok: true,
          data,
        };
      }

      throw new Error(`Unexpected call: ${args.join(' ')}`);
    },
  };
}

test('CliBaseStore.upsertRecord 鍛戒腑鍞竴閿椂浼氭洿鏂板師璁板綍鑰屼笉鏄噸澶嶅垱寤?', async () => {
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
      title: 'Ubuntu 鏂扮増',
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

test('resolveKnowledgeTopics strips date prefixes before picking the primary topic', () => {
  const result = resolveKnowledgeTopics({
    title: '2026-04-05 \u7761\u7720\u4e0e\u5b66\u4e60\u65b9\u6cd5',
    content: '\u6211\u8fd9\u5468\u7761\u7720\u4e0d\u8db3\uff0c\u4f46\u5efa\u8bae\u5148\u56fa\u5b9a\u8d77\u5e8a\u65f6\u95f4\uff0c\u5b66\u4e60\u6548\u7387\u4f1a\u66f4\u7a33\u5b9a\u3002',
  });

  assert.equal(result.primaryTopic, '\u7761\u7720');
  assert.ok(result.secondaryTopics.includes('\u5b66\u4e60'));
});

test('KnowledgeCliService.resolveRoutingTopics falls back to parsed topic when draft primary topic is the full page title', () => {
  const service = new KnowledgeCliService();

  const result = service.resolveRoutingTopics({
    privacyScope: 'personal',
    draft: {
      title: SLEEP_LEARNING_TITLE,
      summary: SLEEP_LEARNING_TEXT,
      topics: {
        primaryTopic: SLEEP_LEARNING_TITLE,
        secondaryTopics: [LEARNING_TOPIC],
      },
    },
  });

  assert.equal(result.primaryTopic, SLEEP_TOPIC);
  assert.ok(result.secondaryTopics.includes(LEARNING_TOPIC));
});

test('KnowledgeCliService.importNodeWithPublish will import a personal page and create AI artifacts', async () => {
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
          content: 'Ubuntu\n闂姹囨€籠n娌℃湁Linux鐜\n涓嬭浇Linux鍐呮牳鏇存柊鍖匼n鍐嶆鐐瑰嚮ubuntu锛岃緭鍏ュ瘑鐮乗n',
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

test.skip('KnowledgeCliService.maintainAiWikiEntry will orchestrate AI wiki maintenance flow', async () => {
  const runner = createMaintenanceRunner();
  const service = new KnowledgeCliService({
    runner,
    baseToken: 'base_1',
  });

  const result = await service.maintainAiWikiEntry({
    title: SLEEP_LEARNING_TITLE,
    content: SLEEP_LEARNING_TEXT,
    summary: SLEEP_LEARNING_TEXT,
    date: '2026-04-05',
    sourceTitle: SLEEP_LEARNING_TITLE,
    sourceUrl: 'https://example.com/journal-source',
    sourceBlocks: [
      {
        blockId: 'blk-1',
        blockUrl: 'https://example.com/journal-source#blk-1',
        text: SLEEP_LEARNING_TEXT,
      },
    ],
  });

  assert.equal(result.classification.type, 'mixed');
  assert.equal(result.pages.personal.primaryTopic, '日记');
  assert.equal(result.pages.personal.title, SLEEP_LEARNING_TITLE);
  assert.ok(result.pages.personal.summary.includes('\u6211\u8fd9\u5468\u7761\u7720\u4e0d\u8db3'));
  assert.equal(result.pages.personal.canonicalNodeToken, 'doc_personal_canonical_node');
  assert.deepEqual(result.pages.personal.shortcutNodeTokens, []);
  assert.equal(result.pages.generic.primaryTopic, SLEEP_TOPIC);
  assert.equal(result.maintenance.indexUpdated, true);
  assert.equal(result.maintenance.timelineUpdated, true);
  assert.equal(result.maintenance.dailyAdviceUpdated, true);

  assert.ok(
    runner.calls.some((args) => args[0] === 'docs' && args[1] === '+update' && args[args.indexOf('--doc') + 1] === 'doc_all_pages'),
    'should update all-pages index'
  );
  assert.ok(
    !runner.calls.some((args) => args[0] === 'wiki' && args[1] === 'nodes' && args[2] === 'create'
      && JSON.parse(args[args.indexOf('--data') + 1]).node_type === 'shortcut'),
    'should not rely on shortcut creation for the new citation model'
  );
  const indexUpdateArgs = runner.calls.find((args) => args[0] === 'docs' && args[1] === '+update' && args[args.indexOf('--doc') + 1] === 'doc_all_pages');
  assert.ok(indexUpdateArgs);
  const indexMarkdown = indexUpdateArgs[indexUpdateArgs.indexOf('--markdown') + 1];
  assert.doesNotMatch(indexMarkdown, /doc_personal_canonical_old/);
  assert.match(indexMarkdown, new RegExp(SLEEP_LEARNING_TITLE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(indexMarkdown, /https:\/\/example\.com\/wiki\/doc_personal_canonical/);
  assert.ok(
    runner.calls.some((args) => args[0] === 'docs' && args[1] === '+update' && args[args.indexOf('--doc') + 1] === 'doc_timeline'),
    'should update timeline'
  );
  const timelineUpdateArgs = runner.calls.find((args) => args[0] === 'docs' && args[1] === '+update' && args[args.indexOf('--doc') + 1] === 'doc_timeline');
  assert.ok(timelineUpdateArgs);
  const timelineMarkdown = timelineUpdateArgs[timelineUpdateArgs.indexOf('--markdown') + 1];
  assert.match(timelineMarkdown, new RegExp(`personal: ${SLEEP_LEARNING_TITLE}`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(timelineMarkdown, /generic: 如何应对睡眠不足带来的学习波动/);
  assert.ok(
    runner.calls.some((args) => args[0] === 'docs' && args[1] === '+update' && args[args.indexOf('--doc') + 1] === 'doc_personal_root'),
    'should prepend daily advice to personal root'
  );
  const dailyAdviceUpdateArgs = runner.calls.find((args) => args[0] === 'docs' && args[1] === '+update' && args[args.indexOf('--doc') + 1] === 'doc_personal_root');
  assert.ok(dailyAdviceUpdateArgs);
  const dailyAdviceMarkdown = dailyAdviceUpdateArgs[dailyAdviceUpdateArgs.indexOf('--markdown') + 1];
  assert.match(dailyAdviceMarkdown, new RegExp(SLEEP_LEARNING_TITLE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  const personalCanonicalUpdateArgs = runner.calls.filter((args) => args[0] === 'docs' && args[1] === '+update' && args[args.indexOf('--doc') + 1] === 'doc_personal_canonical');
  assert.ok(personalCanonicalUpdateArgs.length >= 1);
  const finalPersonalMarkdown = personalCanonicalUpdateArgs.at(-1)[personalCanonicalUpdateArgs.at(-1).indexOf('--markdown') + 1];
  assert.match(finalPersonalMarkdown, /\[如何应对睡眠不足带来的学习波动\]\(https:\/\/example\.com\/docs\/generic-canonical\)/);
  const genericCreateArgs = runner.calls.find((args) => args[0] === 'docs' && args[1] === '+create' && args[args.indexOf('--wiki-node') + 1] === 'topic_sleep_generic');
  assert.ok(genericCreateArgs);
  const genericCreateMarkdown = genericCreateArgs[genericCreateArgs.indexOf('--markdown') + 1];
  assert.match(genericCreateMarkdown, /\[2026-04-05 睡眠与学习方法\]\(https:\/\/example\.com\/wiki\/doc_personal_canonical\)/);
  assert.doesNotMatch(genericCreateMarkdown, /- 2026-04-05 睡眠与学习方法\n- \[2026-04-05 睡眠与学习方法\]/);
});

test('KnowledgeCliService.maintainAiWikiEntry routes a personal page through an existing canonical child page', async () => {
  const runner = createMaintenanceRunner({
    personalCanonicalTitle: SLEEP_RECORD_TITLE,
  });
  const service = new KnowledgeCliService({
    runner,
    baseToken: 'base_1',
  });

  const result = await service.maintainAiWikiEntry({
    title: SLEEP_RECORD_TITLE,
    content: SLEEP_RECORD_TEXT,
    summary: SLEEP_RECORD_TEXT,
  });

  assert.equal(result.classification.type, 'personal');
  assert.equal(result.pages.personal.topicNodeToken, 'topic_sleep');
  assert.equal(result.pages.personal.canonicalNodeToken, 'doc_personal_canonical_node');
  assert.ok(
    !runner.calls.some((args) => args[0] === 'docs' && args[1] === '+update' && args[args.indexOf('--doc') + 1] === 'doc_personal_topic_container'),
    'should not update the topic container doc'
  );
  assert.ok(
    runner.calls.some((args) => args[0] === 'docs' && args[1] === '+update' && args[args.indexOf('--doc') + 1] === 'doc_personal_canonical'),
    'should update the canonical child doc'
  );
});

test.skip('KnowledgeCliService.maintainAiWikiEntry routes a generic page by creating a canonical child page', async () => {
  const runner = createMaintenanceRunner({
    genericCanonicalTitle: SLEEP_METHOD_TITLE,
    genericChildExists: false,
  });
  const service = new KnowledgeCliService({
    runner,
    baseToken: 'base_1',
  });

  const result = await service.maintainAiWikiEntry({
    title: SLEEP_METHOD_TITLE,
    content: SLEEP_METHOD_TEXT,
    summary: SLEEP_METHOD_TEXT,
  });

  assert.equal(result.classification.type, 'generic');
  assert.equal(result.pages.generic.topicNodeToken, 'topic_sleep_generic');
  assert.equal(result.pages.generic.canonicalNodeToken, 'doc_generic_canonical_node');
  assert.ok(
    runner.calls.some((args) => args[0] === 'docs' && args[1] === '+create'
      && args[args.indexOf('--title') + 1] === SLEEP_METHOD_TITLE
      && args[args.indexOf('--wiki-node') + 1] === 'topic_sleep_generic'),
    'should create the canonical child doc under the topic container'
  );
  assert.ok(
    runner.calls.some((args) => args[0] === 'wiki' && args[1] === 'spaces' && args[2] === 'get_node'
      && JSON.parse(args[args.indexOf('--params') + 1]).token === 'doc_generic_canonical'),
    'should resolve the canonical node token from the created doc'
  );
  assert.ok(
    !runner.calls.some((args) => args[0] === 'docs' && args[1] === '+update' && args[args.indexOf('--doc') + 1] === 'doc_generic_topic_container'),
    'should not update the generic topic container doc'
  );
});

test('KnowledgeCliService.maintainAiWikiEntry replaces old index entries for the same page', async () => {
  const runner = createMaintenanceRunner();
  const service = new KnowledgeCliService({
    runner,
    baseToken: 'base_1',
  });

  await service.maintainAiWikiEntry({
    title: SLEEP_LEARNING_TITLE,
    content: SLEEP_LEARNING_TEXT,
    summary: SLEEP_LEARNING_TEXT,
    date: '2026-04-05',
  });

  const indexUpdateArgs = runner.calls.find((args) => args[0] === 'docs' && args[1] === '+update' && args[args.indexOf('--doc') + 1] === 'doc_all_pages');
  assert.ok(indexUpdateArgs);
  const indexMarkdown = indexUpdateArgs[indexUpdateArgs.indexOf('--markdown') + 1];
  assert.doesNotMatch(indexMarkdown, /鏃т釜浜洪〉闈?/);
  assert.match(indexMarkdown, new RegExp(SLEEP_LEARNING_TITLE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('KnowledgeCliService.maintainAiWikiEntry preserves shortcut markers in rebuilt index', async () => {
  const runner = createMaintenanceRunner({
    personalChildExists: false,
  });
  const service = new KnowledgeCliService({
    runner,
    baseToken: 'base_1',
  });

  await service.maintainAiWikiEntry({
    title: SLEEP_LEARNING_TITLE,
    content: SLEEP_LEARNING_TEXT,
    summary: SLEEP_LEARNING_TEXT,
    date: '2026-04-05',
  });

  const indexUpdateArgs = runner.calls.find((args) => args[0] === 'docs' && args[1] === '+update' && args[args.indexOf('--doc') + 1] === 'doc_all_pages');
  assert.ok(indexUpdateArgs);
  const indexMarkdown = indexUpdateArgs[indexUpdateArgs.indexOf('--markdown') + 1];
  assert.match(indexMarkdown, /快捷方式|shortcut/);
  assert.match(indexMarkdown, /旧快捷页面/);
});

test('KnowledgeCliService.maintainAiWikiEntry keeps timeline and daily advice idempotent for the same day', async () => {
  const runner = createMaintenanceRunner({
    timelineMarkdown: `# AI维基百科发展时间线\n\n## 2026-04-05\n\n- personal: ${SLEEP_LEARNING_TITLE}\n- generic: 如何应对睡眠不足带来的学习波动`,
    personalRootMarkdown: `# 个人信息根页\n\n## 2026-04-05\n\n### 对应页面\n\n- [${SLEEP_LEARNING_TITLE}](https://example.com/wiki/doc_personal_canonical)\n`,
  });
  const service = new KnowledgeCliService({
    runner,
    baseToken: 'base_1',
  });

  await service.maintainAiWikiEntry({
    title: SLEEP_LEARNING_TITLE,
    content: SLEEP_LEARNING_TEXT,
    summary: SLEEP_LEARNING_TEXT,
    date: '2026-04-05',
  });

  const timelineUpdateArgs = runner.calls.find((args) => args[0] === 'docs' && args[1] === '+update' && args[args.indexOf('--doc') + 1] === 'doc_timeline');
  const timelineMarkdown = timelineUpdateArgs[timelineUpdateArgs.indexOf('--markdown') + 1];
  assert.equal((timelineMarkdown.match(/## 2026-04-05/g) ?? []).length, 1);

  const dailyAdviceUpdateArgs = runner.calls.find((args) => args[0] === 'docs' && args[1] === '+update' && args[args.indexOf('--doc') + 1] === 'doc_personal_root');
  const dailyAdviceMarkdown = dailyAdviceUpdateArgs[dailyAdviceUpdateArgs.indexOf('--markdown') + 1];
  assert.equal((dailyAdviceMarkdown.match(/## 2026-04-05/g) ?? []).length, 1);
  assert.equal((dailyAdviceMarkdown.match(/### 对应页面/g) ?? []).length, 1);
  assert.match(dailyAdviceMarkdown, new RegExp(SLEEP_LEARNING_TITLE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test.skip('KnowledgeCliService.maintainAiWikiEntry reuses an existing shortcut with the same title', async () => {
  const runner = createMaintenanceRunner({
    personalShortcutExists: true,
    personalShortcutNodeToken: 'shortcut_learning_old',
    personalShortcutOriginNodeToken: 'old-canonical-node',
  });
  const service = new KnowledgeCliService({
    runner,
    baseToken: 'base_1',
  });

  const result = await service.maintainAiWikiEntry({
    title: SLEEP_LEARNING_TITLE,
    content: SLEEP_LEARNING_TEXT,
    summary: SLEEP_LEARNING_TEXT,
    date: '2026-04-05',
  });

  assert.deepEqual(result.pages.personal.shortcutNodeTokens, ['shortcut_learning_old']);
  assert.ok(
    !runner.calls.some((args) => args[0] === 'wiki' && args[1] === 'nodes' && args[2] === 'create'
      && JSON.parse(args[args.indexOf('--data') + 1]).node_type === 'shortcut'
      && JSON.parse(args[args.indexOf('--data') + 1]).title === LEARNING_TOPIC
      && JSON.parse(args[args.indexOf('--data') + 1]).origin_node_token === 'doc_personal_canonical_node'),
    'should reuse the existing same-title shortcut instead of creating a second one'
  );
});

test('KnowledgeCliService.maintainAiWikiEntry preserves pipe characters in rebuilt index entries', async () => {
  const runner = createMaintenanceRunner({
    indexMarkdown: `# AI维基百科所有页面链接\n\n## 包含个人信息\n\n- [带| 管道 的标题](https://example.com/wiki/pipe-page) | 睡眠 | 摘要含| 管道 | 正文\n\n## 不包含个人信息\n\n- 暂无`,
  });
  const service = new KnowledgeCliService({
    runner,
    baseToken: 'base_1',
  });

  await service.maintainAiWikiEntry({
    title: SLEEP_LEARNING_TITLE,
    content: SLEEP_LEARNING_TEXT,
    summary: SLEEP_LEARNING_TEXT,
    date: '2026-04-05',
  });

  const indexUpdateArgs = runner.calls.find((args) => args[0] === 'docs' && args[1] === '+update' && args[args.indexOf('--doc') + 1] === 'doc_all_pages');
  const indexMarkdown = indexUpdateArgs[indexUpdateArgs.indexOf('--markdown') + 1];
  assert.match(indexMarkdown, /\| 管道/);
  assert.match(indexMarkdown, /摘要含\| 管道/);
});
test.skip('KnowledgeCliService.maintainAiWikiEntry falls back to wiki urls when update responses omit doc_url', async () => {
  const runner = createMaintenanceRunner({
    updateDocUrls: {
      doc_personal_canonical: '',
      doc_personal_root: '',
      doc_all_pages: '',
      doc_timeline: '',
    },
  });
  const service = new KnowledgeCliService({
    runner,
    baseToken: 'base_1',
  });

  const result = await service.maintainAiWikiEntry({
    title: SLEEP_LEARNING_TITLE,
    content: SLEEP_LEARNING_TEXT,
    summary: SLEEP_LEARNING_TEXT,
    date: '2026-04-05',
  });

  assert.equal(result.pages.personal.docUrl, 'https://www.feishu.cn/wiki/doc_personal_canonical_node');
  const genericCreateArgs = runner.calls.find((args) => args[0] === 'docs' && args[1] === '+create' && args[args.indexOf('--wiki-node') + 1] === 'topic_sleep_generic');
  assert.ok(genericCreateArgs);
  const genericCreateMarkdown = genericCreateArgs[genericCreateArgs.indexOf('--markdown') + 1];
  assert.match(genericCreateMarkdown, /\[2026-04-05 睡眠与学习方法\]\(https:\/\/www\.feishu\.cn\/wiki\/doc_personal_canonical_node\)/);
});
test.skip('KnowledgeCliService.maintainAiWikiFromJournals 只读取固定 Memory 根下面的日期页和日记页', async () => {
  const runner = createRunnerWithResponses([
    {
      response: {
        code: 0,
        data: {
          node: {
            space_id: 'space_1',
            node_token: 'LNqCw1uVhin6TzkKPLAcDYyVnof',
            obj_token: 'doc_memory_root',
            obj_type: 'docx',
            title: '61 的日记 / Memory',
            has_child: true,
          },
        },
      },
    },
    {
      assert(args) {
        const params = JSON.parse(args[args.indexOf('--params') + 1]);
        assert.equal(params.page_size, 50);
        assert.equal(params.parent_node_token, 'LNqCw1uVhin6TzkKPLAcDYyVnof');
      },
      response: {
        code: 0,
        data: {
          items: [
            {
              space_id: 'space_1',
              node_token: 'memory-entry-older',
              obj_token: 'doc_memory_entry_older',
              obj_type: 'docx',
              title: '2026-04-04 日记',
              has_child: false,
              parent_node_token: 'LNqCw1uVhin6TzkKPLAcDYyVnof',
            },
            {
              space_id: 'space_1',
              node_token: 'memory-entry-newer',
              obj_token: 'doc_memory_entry_newer',
              obj_type: 'docx',
              title: '2026-04-05 日记',
              has_child: false,
              parent_node_token: 'LNqCw1uVhin6TzkKPLAcDYyVnof',
            },
          ],
          has_more: false,
        },
      },
    },
    {
      response: {
        code: 0,
        data: {
          content: '# 2026-04-04 日记\n\n我昨天状态一般，但建议先降低任务强度。',
        },
      },
    },
    {
      response: {
        code: 0,
        data: {
          content: '# 2026-04-05 日记\n\n我这周睡眠不足，但建议先固定起床时间。',
        },
      },
    },
  ]);

  const service = new KnowledgeCliService({
    runner,
    baseToken: 'base_1',
  });
  const calls = [];
  service.maintainAiWikiEntry = async (payload) => {
    calls.push(payload);
    return {
      classification: {
        type: payload.date === '2026-04-05' ? 'mixed' : 'personal',
      },
      pages: {},
      maintenance: {},
    };
  };

  const result = await service.maintainAiWikiFromJournals();

  assert.deepEqual(
    calls.map((item) => ({ title: item.title, date: item.date })),
    [
      { title: '2026-04-04 日记', date: '2026-04-04' },
      { title: '2026-04-05 日记', date: '2026-04-05' },
    ]
  );
  assert.equal(calls[0].sourceLabel, 'Journal/61 的日记 / Memory');
  assert.equal(calls[0].sourceNodeToken, 'memory-entry-older');
  assert.equal(calls[1].sourceNodeToken, 'memory-entry-newer');
  assert.equal(calls[1].primaryTopic, '睡眠');
  assert.ok(calls[1].secondaryTopics.length <= 3);
  assert.equal(result.summary.journalEntryCount, 2);
  assert.equal(result.summary.processedCount, 2);
  assert.equal(result.entries[1].classification.type, 'mixed');
});

test('KnowledgeCliService.buildJournalMaintenanceInput 会为长日记收敛摘要和主题', () => {
  const service = new KnowledgeCliService();

  const input = service.buildJournalMaintenanceInput({
    entryNode: {
      title: '2026-04-05 日记',
      node_token: 'journal_1',
      journalDate: '2026-04-05',
      journalMemoryRootTitle: '按日期记录',
      journalDatePageToken: 'LNqCw1uVhin6TzkKPLAcDYyVnof',
      journalDatePageTitle: '按日期记录',
    },
    rawContent: `# 2026-04-05 日记

今日摘要
最近睡眠不足，学习效率下降，运动恢复也受影响。

事件记录
我今天继续思考工作流追踪系统，也反思了刷手机和考研复习的冲突。

想法与反思
需要建立更稳定的工作方法，并控制作息。`,
  });

  assert.equal(input.primaryTopic, '睡眠');
  assert.ok(input.secondaryTopics.includes('学习'));
  assert.ok(input.secondaryTopics.length <= 3);
  assert.ok(input.summary.length <= 280);
});

test('KnowledgeCliService.fetchWikiChildren 遇到限流会自动重试', async () => {
  const runner = createRunnerWithResponses([
    {
      response: {
        ok: false,
        error: {
          code: 99991400,
          message: 'rate limited',
        },
      },
    },
    {
      response: {
        code: 0,
        data: {
          items: [
            {
              space_id: 'space_1',
              node_token: 'topic_sleep',
              obj_token: 'doc_topic_sleep',
              obj_type: 'docx',
              title: '睡眠',
              has_child: false,
            },
          ],
          has_more: false,
        },
      },
    },
  ]);

  const service = new KnowledgeCliService({
    runner,
    rateLimitRetryDelayMs: 0,
    rateLimitMaxRetries: 1,
  });

  const children = await service.fetchWikiChildren({
    spaceId: 'space_1',
    parentNodeToken: 'Ne9wwI7T0ie8xJkeDnvc6RR9nuh',
  });

  assert.equal(children.length, 1);
  assert.equal(children[0].title, '睡眠');
  assert.equal(runner.calls.length, 2);
});

test('KnowledgeCliService.fetchWikiChildren 会缓存同一父节点的子节点列表', async () => {
  const runner = createRunnerWithResponses([
    {
      response: {
        code: 0,
        data: {
          items: [
            {
              space_id: 'space_1',
              node_token: 'topic_sleep',
              obj_token: 'doc_topic_sleep',
              obj_type: 'docx',
              title: '睡眠',
              has_child: false,
            },
          ],
          has_more: false,
        },
      },
    },
  ]);

  const service = new KnowledgeCliService({
    runner,
  });

  const first = await service.fetchWikiChildren({
    spaceId: 'space_1',
    parentNodeToken: 'Ne9wwI7T0ie8xJkeDnvc6RR9nuh',
  });
  const second = await service.fetchWikiChildren({
    spaceId: 'space_1',
    parentNodeToken: 'Ne9wwI7T0ie8xJkeDnvc6RR9nuh',
  });

  assert.equal(first.length, 1);
  assert.equal(second.length, 1);
  assert.equal(runner.calls.length, 1);
});

test('KnowledgeCliService.maintainAiWikiEntry 会保留飞书压缩空行后的旧索引条目', async () => {
  const runner = createMaintenanceRunner({
    indexMarkdown: '# AI维基百科所有页面链接\n## 包含个人信息\n- [2026-03-31 日记](https://www.feishu.cn/wiki/S1YTwmgggiPkJnkuzancjdKrn0z) | 学习 | 旧摘要 | 正文\n## 不包含个人信息\n- [如何应对学习相关的运动](https://www.feishu.cn/wiki/ACRnwVo4eiMyMMkSV07ceFsmndh) | 学习 | 旧通用摘要 | 正文',
    personalChildExists: false,
  });
  const service = new KnowledgeCliService({
    runner,
    baseToken: 'base_1',
  });

  await service.maintainAiWikiEntry({
    title: SLEEP_LEARNING_TITLE,
    content: SLEEP_LEARNING_TEXT,
    summary: SLEEP_LEARNING_TEXT,
    date: '2026-04-05',
  });

  const indexUpdateArgs = runner.calls.find((args) => args[0] === 'docs' && args[1] === '+update' && args[args.indexOf('--doc') + 1] === 'doc_all_pages');
  const indexMarkdown = indexUpdateArgs[indexUpdateArgs.indexOf('--markdown') + 1];
  assert.match(indexMarkdown, /\[2026-03-31 日记\]/);
  assert.match(indexMarkdown, /\[如何应对学习相关的运动\]/);
  assert.match(indexMarkdown, new RegExp(SLEEP_LEARNING_TITLE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});
