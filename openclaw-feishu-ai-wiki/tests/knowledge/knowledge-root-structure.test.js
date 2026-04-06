import test from 'node:test';
import assert from 'node:assert/strict';

import { KnowledgeCliService } from '../../src/services/knowledgeCli.js';

function valueAfter(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : '';
}

test('fetchAiMaintenanceContext 会确保根节点下 7 个固定页存在，并复用旧的引页节点', async () => {
  const calls = [];
  const rootToken = process.env.AI_WIKI_SYSTEM_ROOT;

  const nodesByToken = {
    [rootToken]: {
      space_id: 'space_1',
      node_token: rootToken,
      obj_token: 'doc_root',
      obj_type: 'docx',
      title: 'AI知识库（codex）',
      node_type: 'origin',
    },
    root_ai: {
      space_id: 'space_1',
      node_token: 'root_ai',
      obj_token: 'doc_ai_root',
      obj_type: 'docx',
      title: 'AI维基百科',
      node_type: 'origin',
    },
    root_legacy_index: {
      space_id: 'space_1',
      node_token: 'root_legacy_index',
      obj_token: 'doc_legacy_index',
      obj_type: 'docx',
      title: 'AI知识库引页',
      node_type: 'origin',
    },
  };

  const childrenByParent = {
    [rootToken]: [
      nodesByToken.root_ai,
      nodesByToken.root_legacy_index,
    ],
  };

  const runner = {
    async runJson(args) {
      calls.push(args);

      if (args[0] === 'wiki' && args[1] === 'spaces' && args[2] === 'get_node') {
        const params = JSON.parse(valueAfter(args, '--params'));
        return {
          code: 0,
          data: {
            node: nodesByToken[params.token],
          },
        };
      }

      if (args[0] === 'wiki' && args[1] === 'nodes' && args[2] === 'list') {
        const params = JSON.parse(valueAfter(args, '--params'));
        return {
          code: 0,
          data: {
            items: childrenByParent[params.parent_node_token] ?? [],
            has_more: false,
          },
        };
      }

      if (args[0] === 'docs' && args[1] === '+fetch') {
        const docId = valueAfter(args, '--doc');
        return {
          ok: true,
          data: {
            content: docId === 'doc_legacy_index' ? '# AI知识库引页' : '',
          },
        };
      }

      if (args[0] === 'docs' && args[1] === '+update') {
        return {
          ok: true,
          data: {
            doc_id: valueAfter(args, '--doc'),
            doc_url: `https://example.com/wiki/${valueAfter(args, '--doc')}`,
          },
        };
      }

      if (args[0] === 'wiki' && args[1] === 'nodes' && args[2] === 'create') {
        const data = JSON.parse(valueAfter(args, '--data'));
        const created = {
          space_id: 'space_1',
          node_token: `created_${data.title}`,
          obj_token: `doc_${data.title}`,
          obj_type: 'docx',
          title: data.title,
          node_type: 'origin',
        };
        childrenByParent[data.parent_node_token] ??= [];
        childrenByParent[data.parent_node_token].push(created);
        return {
          code: 0,
          data: {
            node: created,
          },
        };
      }

      if (args[0] === 'docs' && args[1] === '+create') {
        return {
          ok: true,
          data: {
            doc_id: 'doc_created',
            doc_url: 'https://example.com/wiki/doc_created',
          },
        };
      }

      throw new Error(`Unexpected call: ${args.join(' ')}`);
    },
  };

  const service = new KnowledgeCliService({ runner, baseToken: 'base_1' });
  const context = await service.fetchAiMaintenanceContext();

  assert.equal(context.systemRoot.node.title, 'AI知识库（codex）');
  assert.equal(context.genericInfoRoot.node.title, 'AI维基百科');
  assert.equal(context.allPagesIndex.node.title, 'AI维基百科所有页面索引');
  assert.equal(context.maintenanceGuide.node.title, 'AI维基百科运行维护指南');
  assert.equal(context.timelinePage.node.title, 'AI维基百科维护历史记录');
  assert.equal(context.personalInfoRoot.node.title, '个人信息汇集');
  assert.equal(context.outputRoot.node.title, 'output');
  assert.equal(context.archiveRoot.node.title, '归档');

  const renameCall = calls.find((args) =>
    args[0] === 'docs'
    && args[1] === '+update'
    && valueAfter(args, '--doc') === 'doc_legacy_index'
  );

  assert.ok(renameCall);
  assert.equal(valueAfter(renameCall, '--new-title'), 'AI维基百科所有页面索引');

  const createTitles = calls
    .filter((args) => args[0] === 'wiki' && args[1] === 'nodes' && args[2] === 'create')
    .map((args) => JSON.parse(valueAfter(args, '--data')).title);

  assert.deepEqual(createTitles.sort((a, b) => a.localeCompare(b, 'zh-CN')), [
    'AI维基百科维护历史记录',
    'AI维基百科所有页面索引',
    'AI维基百科运行维护指南',
    'output',
    '个人信息汇集',
    '归档',
  ].filter((title) => title !== 'AI维基百科所有页面索引').sort((a, b) => a.localeCompare(b, 'zh-CN')));
});
