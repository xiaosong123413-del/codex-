import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildAiKnowledgePageMarkdown,
  buildKnowledgeArtifacts,
} from '../../src/knowledge/graph.js';

test('图谱产物包含个人页、AI 页、块级引用、来源和映射', () => {
  const artifacts = buildKnowledgeArtifacts({
    personalNode: {
      nodeId: 'personal:resource-child-1',
      nodeToken: 'resource-child-1',
      title: '资源 1',
      library: 'personal',
      kind: 'personal_page',
      rootKey: 'resource',
    },
    aiNode: {
      nodeId: 'ai:resource-child-1',
      nodeToken: 'ai-resource-child-1',
      title: 'AI/资源 1',
      library: 'ai',
      kind: 'ai_page',
    },
    sourceBlocks: [
      {
        blockId: 'blk_1',
        text: '核心观点 A',
      },
      {
        blockId: 'blk_2',
        text: '核心观点 B',
      },
    ],
    contextNodes: [
      {
        nodeId: 'context:project-alpha',
        nodeToken: 'project-alpha',
        title: '项目 Alpha',
        relationType: 'belongs_to_project',
      },
      {
        nodeId: 'context:area-writing',
        nodeToken: 'area-writing',
        title: '写作领域',
        relationType: 'belongs_to_area',
      },
    ],
    messageSources: [
      {
        messageId: 'om_dc123',
        chatId: 'oc_100',
        text: '这里是原始消息证据',
      },
    ],
  });

  assert.equal(artifacts.nodes.length, 5);
  assert.equal(artifacts.edges.length, 5);
  assert.equal(artifacts.sources.length, 3);
  assert.equal(artifacts.mappings.length, 1);

  assert.deepEqual(
    artifacts.edges.map((edge) => edge.type),
    [
      'derived_from',
      'quotes_block',
      'quotes_block',
      'belongs_to_project',
      'belongs_to_area',
    ]
  );

  assert.deepEqual(artifacts.mappings[0], {
    mappingId: 'mapping:personal:resource-child-1->ai:resource-child-1',
    personalNodeId: 'personal:resource-child-1',
    aiNodeId: 'ai:resource-child-1',
    direction: 'personal_to_ai',
  });
});

test('AI 页 markdown 包含来源、上下文、反链和证据区块', () => {
  const markdown = buildAiKnowledgePageMarkdown({
    title: 'AI/资源 1',
    summary: '这是一页由 AI 自动整理的知识卡片。',
    sourcePage: {
      title: '资源 1',
      url: 'https://example.com/wiki/resource-1',
    },
    sourceBlocks: [
      { text: '核心观点 A' },
      { text: '核心观点 B' },
    ],
    backlinks: [
      {
        title: 'AI/专题整理',
        url: 'https://example.com/wiki/ai-topic',
      },
    ],
    contextNodes: [
      { title: '项目 Alpha', relationLabel: '关联项目' },
      { title: '写作领域', relationLabel: '关联领域' },
    ],
    messageSources: [
      { text: '消息证据 1' },
    ],
  });

  assert.match(markdown, /^# AI\/资源 1/m);
  assert.match(markdown, /## 摘要/);
  assert.match(markdown, /## 来源页面/);
  assert.match(markdown, /\[资源 1\]\(https:\/\/example\.com\/wiki\/resource-1\)/);
  assert.match(markdown, /## 来源块/);
  assert.match(markdown, /核心观点 A/);
  assert.match(markdown, /## 关联上下文/);
  assert.match(markdown, /关联项目：项目 Alpha/);
  assert.match(markdown, /## 反向链接/);
  assert.match(markdown, /\[AI\/专题整理\]\(https:\/\/example\.com\/wiki\/ai-topic\)/);
  assert.match(markdown, /## 消息证据/);
});
