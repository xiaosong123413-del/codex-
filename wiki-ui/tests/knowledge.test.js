import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildFallbackReply,
  buildResearchBrief,
  buildReviewFeed,
  resolveActivePage,
  searchKnowledge,
} from '../lib/knowledge.js';

const pageMeta = {
  pages: [
    {
      path: '概念/AI知识库构建.md',
      title: 'AI知识库构建',
      category: '概念',
      abstract: '关于第二大脑和知识库编译的概念页。',
      tags: ['知识库', '编译'],
      headings: ['AI知识库构建', 'Compiled Truth'],
      sources: ['来源/2026-04-12-AI知识库工作流与剪藏体系.md'],
    },
    {
      path: '来源/2026-04-12-AI知识库工作流与剪藏体系.md',
      title: 'AI知识库工作流与剪藏体系',
      category: '来源',
      abstract: '关于吸收与整理流程的来源页。',
      tags: ['来源'],
      headings: ['AI知识库工作流与剪藏体系'],
      sources: [],
    },
  ],
};

const searchIndex = {
  documents: [
    {
      path: '概念/AI知识库构建.md',
      title: 'AI知识库构建',
      category: '概念',
      text: 'AI知识库构建 重点是编译型知识库和第二大脑工作流。',
      tags: ['知识库', '编译'],
    },
    {
      path: '来源/2026-04-12-AI知识库工作流与剪藏体系.md',
      title: 'AI知识库工作流与剪藏体系',
      category: '来源',
      text: '吸收流程从 raw 到 来源 再到正式知识页。',
      tags: ['来源'],
    },
  ],
};

test('resolveActivePage enriches selected page with searchable text', () => {
  const page = resolveActivePage({
    pageMeta,
    searchIndex,
    requestedPath: '概念/AI知识库构建.md',
  });

  assert.equal(page?.path, '概念/AI知识库构建.md');
  assert.match(page?.text ?? '', /编译型知识库/);
  assert.deepEqual(page?.sources, ['来源/2026-04-12-AI知识库工作流与剪藏体系.md']);
});

test('searchKnowledge prioritizes title matches over body-only matches', () => {
  const results = searchKnowledge({
    searchIndex,
    query: 'AI知识库',
    limit: 2,
  });

  assert.equal(results.length, 2);
  assert.equal(results[0]?.path, '概念/AI知识库构建.md');
});

test('buildReviewFeed combines lint findings with persisted review items', () => {
  const reviewFeed = buildReviewFeed({
    lint: {
      brokenLinks: [{ from: '概念/AI知识库构建.md', target: '概念/缺失页面' }],
      orphanPages: ['来源/2026-04-12-AI知识库工作流与剪藏体系.md'],
    },
    absorbLog: {
      entries: {
        'raw/example.md': {
          status: 'pending',
          notes: 'Needs absorb',
        },
      },
    },
    persistedItems: [
      {
        id: 'review_1',
        sourcePath: '来源/2026-04-12-AI知识库工作流与剪藏体系.md',
        status: 'open',
        payloadJson: '{"reason":"manual"}',
      },
    ],
  });

  assert.equal(reviewFeed.length, 4);
  assert.equal(reviewFeed[0]?.kind, 'persisted');
  assert.equal(reviewFeed[1]?.kind, 'broken-link');
  assert.equal(reviewFeed[2]?.kind, 'orphan-page');
  assert.equal(reviewFeed[3]?.kind, 'absorb-pending');
});

test('buildFallbackReply grounds answer in matched pages and active page', () => {
  const activePage = resolveActivePage({
    pageMeta,
    searchIndex,
    requestedPath: '概念/AI知识库构建.md',
  });
  const matches = searchKnowledge({ searchIndex, query: '第二大脑', limit: 2 });

  const reply = buildFallbackReply({
    prompt: '第二大脑怎么维护？',
    activePage,
    matches,
  });

  assert.match(reply, /第二大脑怎么维护/);
  assert.match(reply, /AI知识库构建/);
  assert.match(reply, /来源\/2026-04-12-AI知识库工作流与剪藏体系\.md/);
});

test('buildResearchBrief returns questions and candidate sources for a topic', () => {
  const brief = buildResearchBrief({
    topic: '知识库工作流',
    searchIndex,
    pageMeta,
  });

  assert.equal(brief.topic, '知识库工作流');
  assert.ok(brief.questions.length >= 2);
  assert.equal(brief.candidateSources[0]?.path, '来源/2026-04-12-AI知识库工作流与剪藏体系.md');
  assert.ok(brief.candidateSources.length >= 1);
});
