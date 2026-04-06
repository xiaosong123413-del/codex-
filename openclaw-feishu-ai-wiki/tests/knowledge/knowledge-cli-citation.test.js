import test from 'node:test';
import assert from 'node:assert/strict';

import { KnowledgeCliService } from '../../src/services/knowledgeCli.js';

function valueAfter(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : '';
}

function createCitationRunner() {
  const calls = [];
  const rootToken = process.env.AI_WIKI_SYSTEM_ROOT;

  const markdownByDocId = {
    doc_system_root: '# AI知识库（codex）',
    doc_personal_root: '# 个人信息汇集',
    doc_generic_root: '# AI维基百科',
    doc_all_pages: '# AI维基百科所有页面索引\n\n## 包含个人信息\n\n- 暂无\n\n## 不包含个人信息\n\n- 暂无',
    doc_timeline: '# AI维基百科维护历史记录',
    doc_guide: '# AI维基百科运行维护指南',
    doc_index_root: '# AI知识库引页',
    doc_output_root: '# output',
    doc_archive_root: '# 归档',
  };

  const nodeByToken = {
    [rootToken]: {
      space_id: 'space_1',
      node_token: rootToken,
      obj_token: 'doc_system_root',
      obj_type: 'docx',
      title: 'AI知识库（codex）',
      node_type: 'origin',
    },
    Ne9wwI7T0ie8xJkeDnvc6RR9nuh: {
      space_id: 'space_1',
      node_token: 'Ne9wwI7T0ie8xJkeDnvc6RR9nuh',
      obj_token: 'doc_personal_root',
      obj_type: 'docx',
      title: '个人信息汇集',
      node_type: 'origin',
    },
    ZKYew0Ny9imYlYkztATcwJRCnVb: {
      space_id: 'space_1',
      node_token: 'ZKYew0Ny9imYlYkztATcwJRCnVb',
      obj_token: 'doc_generic_root',
      obj_type: 'docx',
      title: 'AI维基百科',
      node_type: 'origin',
    },
    N1lzwE6UciGFOIkMH3Fcf66Gnkf: {
      space_id: 'space_1',
      node_token: 'N1lzwE6UciGFOIkMH3Fcf66Gnkf',
      obj_token: 'doc_all_pages',
      obj_type: 'docx',
      title: 'AI维基百科所有页面索引',
      node_type: 'origin',
    },
    Dq9rwWauLiLTxbky1bkch3rPnDb: {
      space_id: 'space_1',
      node_token: 'Dq9rwWauLiLTxbky1bkch3rPnDb',
      obj_token: 'doc_timeline',
      obj_type: 'docx',
      title: 'AI维基百科维护历史记录',
      node_type: 'origin',
    },
    KpEawjD4ViIvmlkdXP0cAcmGn1c: {
      space_id: 'space_1',
      node_token: 'KpEawjD4ViIvmlkdXP0cAcmGn1c',
      obj_token: 'doc_guide',
      obj_type: 'docx',
      title: 'AI维基百科运行维护指南',
      node_type: 'origin',
    },
    E2GfwBUPQiGKKFkVDRsc8wtsnUj: {
      space_id: 'space_1',
      node_token: 'E2GfwBUPQiGKKFkVDRsc8wtsnUj',
      obj_token: 'doc_index_root',
      obj_type: 'docx',
      title: 'AI知识库引页',
      node_type: 'origin',
    },
    output_root_token: {
      space_id: 'space_1',
      node_token: 'output_root_token',
      obj_token: 'doc_output_root',
      obj_type: 'docx',
      title: 'output',
      node_type: 'origin',
    },
    archive_root_token: {
      space_id: 'space_1',
      node_token: 'archive_root_token',
      obj_token: 'doc_archive_root',
      obj_type: 'docx',
      title: '归档',
      node_type: 'origin',
    },
  };

  const childrenByParent = {
    [rootToken]: [
      nodeByToken.KpEawjD4ViIvmlkdXP0cAcmGn1c,
      nodeByToken.Dq9rwWauLiLTxbky1bkch3rPnDb,
      nodeByToken.N1lzwE6UciGFOIkMH3Fcf66Gnkf,
      nodeByToken.ZKYew0Ny9imYlYkztATcwJRCnVb,
      nodeByToken.Ne9wwI7T0ie8xJkeDnvc6RR9nuh,
      nodeByToken.output_root_token,
      nodeByToken.archive_root_token,
    ],
    Ne9wwI7T0ie8xJkeDnvc6RR9nuh: [],
    ZKYew0Ny9imYlYkztATcwJRCnVb: [],
  };

  const slug = (value) => String(value)
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^\w\u4e00-\u9fa5-]/g, '');

  const ensureChildNode = ({ parentNodeToken, title }) => {
    const key = `${parentNodeToken}:${title}`;
    if (!nodeByToken[key]) {
      const node = {
        space_id: 'space_1',
        node_token: `node_${slug(title)}`,
        obj_token: `doc_container_${slug(title)}`,
        obj_type: 'docx',
        title,
        node_type: 'origin',
      };
      nodeByToken[key] = node;
      childrenByParent[parentNodeToken] = childrenByParent[parentNodeToken] ?? [];
      childrenByParent[parentNodeToken].push(node);
    }

    return nodeByToken[key];
  };

  return {
    calls,
    markdownByDocId,
    async runJson(args) {
      calls.push(args);

      if (args[0] === 'wiki' && args[1] === 'spaces' && args[2] === 'get_node') {
        const params = JSON.parse(valueAfter(args, '--params'));
        if (nodeByToken[params.token]) {
          return { code: 0, data: { node: nodeByToken[params.token] } };
        }

        if (params.token.startsWith('doc_created_')) {
          return {
            code: 0,
            data: {
              node: {
                space_id: 'space_1',
                node_token: params.token.replace('doc_created_', 'node_created_'),
                obj_token: params.token,
                obj_type: 'docx',
                title: params.token,
                node_type: 'origin',
              },
            },
          };
        }
      }

      if (args[0] === 'docs' && args[1] === '+fetch') {
        const docId = valueAfter(args, '--doc');
        return { ok: true, data: { content: markdownByDocId[docId] ?? '' } };
      }

      if (args[0] === 'wiki' && args[1] === 'nodes' && args[2] === 'list') {
        const params = JSON.parse(valueAfter(args, '--params'));
        return {
          code: 0,
          data: { items: childrenByParent[params.parent_node_token] ?? [], has_more: false },
        };
      }

      if (args[0] === 'wiki' && args[1] === 'nodes' && args[2] === 'create') {
        const data = JSON.parse(valueAfter(args, '--data'));
        const node = ensureChildNode({
          parentNodeToken: data.parent_node_token,
          title: data.title,
        });
        return { code: 0, data: { node } };
      }

      if (args[0] === 'docs' && args[1] === '+create') {
        const title = valueAfter(args, '--title');
        const markdown = valueAfter(args, '--markdown');
        const docId = `doc_created_${slug(title)}`;
        markdownByDocId[docId] = markdown;
        return {
          ok: true,
          data: {
            doc_id: docId,
            doc_url: `https://example.com/wiki/${docId.replace('doc_created_', 'node_created_')}`,
          },
        };
      }

      if (args[0] === 'docs' && args[1] === '+update') {
        const docId = valueAfter(args, '--doc');
        const markdown = valueAfter(args, '--markdown');
        markdownByDocId[docId] = markdown;
        return {
          ok: true,
          data: {
            doc_id: docId,
            doc_url: `https://example.com/wiki/${docId.replace('doc_', 'node_')}`,
          },
        };
      }

      throw new Error(`Unexpected call: ${args.join(' ')}`);
    },
  };
}

test('maintainAiWikiEntry extracts mixed content into a target doc with inline 引自', async () => {
  const runner = createCitationRunner();
  const service = new KnowledgeCliService({ runner, baseToken: 'base_1' });

  const result = await service.maintainAiWikiEntry({
    title: '2026-04-06 日记',
    content: '今天我因为飞书记录系统这件事有点烦，但我后来想明白了，问题不在模板，而在内容分类和引用机制没有分开设计。',
    date: '2026-04-06',
    sourceTitle: '2026-04-06',
    sourceUrl: 'https://example.com/journal',
    sourceBlocks: [
      {
        blockId: 'blk-2',
        blockUrl: 'https://example.com/journal#blk-2',
        text: '今天我因为飞书记录系统这件事有点烦，但我后来想明白了，问题不在模板，而在内容分类和引用机制没有分开设计。',
      },
    ],
  });

  assert.equal(result.classification.type, 'mixed');
  assert.ok(result.pages.personal);
  assert.ok(result.pages.targets.length >= 1);
  assert.equal(result.pages.personal.title, '2026-04-06');

  const contentMarkdowns = runner.calls
    .filter((args) => args[0] === 'docs' && ['+create', '+update'].includes(args[1]))
    .map((args) => args[args.indexOf('--markdown') + 1])
    .filter((markdown) => typeof markdown === 'string' && markdown.startsWith('# '))
    .filter((markdown) => !markdown.includes('## 包含个人信息') && !markdown.includes('## 2026-04-06'));

  assert.ok(contentMarkdowns.some((markdown) => /引自：\s*\[2026-04-06 \/ blk-2\]\(https:\/\/example\.com\/journal#blk-2\)/u.test(markdown)));
  for (const markdown of contentMarkdowns) {
    assert.doesNotMatch(markdown, /关联文档/u);
  }
});

test('maintainAiWikiEntry keeps inherited 来源 citations in journal paragraphs', async () => {
  const runner = createCitationRunner();
  const service = new KnowledgeCliService({ runner, baseToken: 'base_1' });

  await service.maintainAiWikiEntry({
    title: '2026-04-06 日记',
    content: '今天继续按之前定下来的规则整理记录系统，尤其是混合内容必须拆开处理这一点，确实比原来清晰很多。',
    date: '2026-04-06',
    sourceTitle: '2026-04-06',
    sourceUrl: 'https://example.com/journal',
    sourceBlocks: [
      {
        blockId: 'blk-3',
        blockUrl: 'https://example.com/journal#blk-3',
        text: '今天继续按之前定下来的规则整理记录系统，尤其是混合内容必须拆开处理这一点，确实比原来清晰很多。',
        citations: [
          {
            label: '来源',
            title: '飞书记录系统设计规则 / blk-3',
            blockUrl: 'https://example.com/rules#blk-3',
          },
        ],
      },
    ],
  });

  const personalCreateCall = runner.calls.find(
    (args) => args[0] === 'docs' && args[1] === '+create' && valueAfter(args, '--title') === '2026-04-06'
  );
  assert.ok(personalCreateCall);
  const personalMarkdown = personalCreateCall[personalCreateCall.indexOf('--markdown') + 1];
  assert.match(personalMarkdown, /来源：\s*\[飞书记录系统设计规则 \/ blk-3\]\(https:\/\/example\.com\/rules#blk-3\)/u);
});

test('maintainAiWikiEntry promotes strong health signals into the 健康 page', async () => {
  const runner = createCitationRunner();
  const service = new KnowledgeCliService({ runner, baseToken: 'base_1' });

  const result = await service.maintainAiWikiEntry({
    title: '2026-04-06 日记',
    content: `这周连续两天睡眠不足，明显影响学习效率。
今天运动后恢复效果很明显，精力比昨天好很多。`,
    date: '2026-04-06',
    sourceTitle: '2026-04-06',
    sourceUrl: 'https://example.com/journal',
    sourceBlocks: [
      {
        blockId: 'blk-1',
        blockUrl: 'https://example.com/journal#blk-1',
        text: '这周连续两天睡眠不足，明显影响学习效率。',
      },
      {
        blockId: 'blk-2',
        blockUrl: 'https://example.com/journal#blk-2',
        text: '今天运动后恢复效果很明显，精力比昨天好很多。',
      },
    ],
  });

  assert.ok(result.pages.personalThemes.some((page) => page.title === '健康'));
  const healthCall = runner.calls.find(
    (args) => args[0] === 'docs' && args.includes('--title') && valueAfter(args, '--title') === '健康'
  );
  assert.ok(healthCall);
  const healthMarkdown = valueAfter(healthCall, '--markdown');
  assert.match(healthMarkdown, /## 睡眠/u);
  assert.match(healthMarkdown, /引自：\s*\[2026-04-06 \/ blk-1\]/u);
});

test('maintainAiWikiFromJournals forwards descendant block ids into maintenance input', async () => {
  const calls = [];
  const runner = {
    async runJson(args) {
      if (args[0] === 'wiki' && args[1] === 'spaces' && args[2] === 'get_node') {
        return {
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
        };
      }

      if (args[0] === 'wiki' && args[1] === 'nodes' && args[2] === 'list') {
        return {
          code: 0,
          data: {
            items: [
              {
                space_id: 'space_1',
                node_token: 'memory-entry-1',
                obj_token: 'doc_entry_1',
                obj_type: 'docx',
                title: '2026-04-06',
                has_child: false,
              },
            ],
            has_more: false,
          },
        };
      }

      if (args[0] === 'api' && args[1] === 'GET' && args[2] === '/open-apis/docx/v1/documents/doc_entry_1/raw_content') {
        return {
          code: 0,
          data: {
            content: '# 2026-04-06\n\n今天我因为飞书记录系统这件事有点烦，但我后来想明白了，问题不在模板，而在内容分类和引用机制没有分开设计。',
          },
        };
      }

      if (args[0] === 'api' && args[1] === 'GET' && args[2] === '/open-apis/docx/v1/documents/doc_entry_1/blocks') {
        return {
          code: 0,
          data: {
            items: [
              {
                block_id: 'blk-9',
                text: '今天我因为飞书记录系统这件事有点烦，但我后来想明白了，问题不在模板，而在内容分类和引用机制没有分开设计。',
              },
            ],
            has_more: false,
          },
        };
      }

      throw new Error(`Unexpected call: ${args.join(' ')}`);
    },
  };

  const service = new KnowledgeCliService({ runner, baseToken: 'base_1' });
  service.maintainAiWikiEntry = async (payload) => {
    calls.push(payload);
    return {
      classification: { type: 'mixed' },
      pages: {},
      maintenance: {},
    };
  };

  await service.maintainAiWikiFromJournals({
    nodeTokens: ['memory-entry-1'],
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].sourceBlocks[0].blockId, 'blk-9');
});
