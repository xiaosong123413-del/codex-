import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildAiAllPagesIndexMarkdown,
  buildCitationMarkdown,
  buildDailyAdviceBlock,
  buildGenericKnowledgeMarkdown,
  buildPersonalKnowledgeMarkdown,
  classifyKnowledgeContent,
  resolveKnowledgeTopics,
  segmentKnowledgeBlocks,
  splitMixedKnowledge,
} from '../../src/knowledge/aiWiki.js';

test('仅有个人信息只会被识别为 personal', () => {
  const result = classifyKnowledgeContent({
    content: '今天晚上有点累，头也有点疼。下午和朋友聊完之后心情好了很多，晚上准备早点睡。',
  });

  assert.equal(result.type, 'personal');
});

test('混合内容会拆出个人句段和非个人句段', () => {
  const result = splitMixedKnowledge({
    title: '飞书记录系统',
    content: '今天我因为飞书记录系统这件事有点烦，但我后来想明白了，问题不在模板，而在内容分类和引用机制没有分开设计。',
    date: '2026-04-06',
  });

  assert.equal(result.classification.type, 'mixed');
  assert.deepEqual(result.personalSegments, ['今天我因为飞书记录系统这件事有点烦']);
  assert.deepEqual(result.knowledgeSegments, ['问题不在模板', '而在内容分类和引用机制没有分开设计。']);
  assert.equal(result.personal.title, '2026-04-06 飞书记录系统');
});

test('非个人信息会被识别为 generic 并命中主题', () => {
  const result = classifyKnowledgeContent({
    content: '飞书记录系统后续需要增加一层判断：先区分个人信息、混合信息、非个人信息，再决定写入日记、项目文档还是主题文档。',
  });
  const topics = resolveKnowledgeTopics({
    content: '飞书记录系统后续需要增加一层判断：先区分个人信息、混合信息、非个人信息，再决定写入日记、项目文档还是主题文档。',
  });

  assert.equal(result.type, 'generic');
  assert.equal(topics.primaryTopic, '项目');
});

test('按自然段切块时会保留来源块信息', () => {
  const blocks = segmentKnowledgeBlocks({
    title: '2026-04-06 日记',
    sourceUrl: 'https://example.com/journal',
    content: `今天晚上有点累，头也有点疼。

飞书记录系统后续需要增加一层判断：先区分个人信息、混合信息、非个人信息，再决定写入日记、项目文档还是主题文档。`,
    sourceBlocks: [
      { blockId: 'blk-1', blockUrl: 'https://example.com/journal#blk-1' },
      { blockId: 'blk-2', blockUrl: 'https://example.com/journal#blk-2' },
    ],
  });

  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].source.blockId, 'blk-1');
  assert.equal(blocks[1].source.blockUrl, 'https://example.com/journal#blk-2');
});

test('目标文档里的段落会在段落旁渲染引自块链接', () => {
  const markdown = buildGenericKnowledgeMarkdown({
    title: '飞书记录系统项目文档',
    entries: [
      {
        text: '当前系统的核心问题不在模板本身，而在内容分类机制与引用机制没有分开设计。',
        citations: [
          {
            label: '引自',
            title: '2026-04-06 日记 / 块 2',
            blockUrl: 'https://example.com/journal#blk-2',
          },
        ],
      },
    ],
  });

  assert.match(markdown, /当前系统的核心问题不在模板本身/);
  assert.match(markdown, /引自：\[2026-04-06 日记 \/ 块 2\]\(https:\/\/example\.com\/journal#blk-2\)/);
  assert.doesNotMatch(markdown, /相关内容见今日日记|另见：/);
});

test('今日日记中的段落可以引用旧规则文档来源', () => {
  const markdown = buildPersonalKnowledgeMarkdown({
    title: '2026-04-06 日记',
    entries: [
      {
        text: '今天继续按之前定下来的规则整理记录系统，尤其是混合内容必须拆开处理这一点，确实比原来清晰很多。',
        citations: [
          {
            label: '来源',
            title: '飞书记录系统设计规则 / 块 3',
            blockUrl: 'https://example.com/rules#blk-3',
          },
        ],
      },
    ],
  });

  assert.match(markdown, /今天继续按之前定下来的规则整理记录系统/);
  assert.match(markdown, /来源：\[飞书记录系统设计规则 \/ 块 3\]\(https:\/\/example\.com\/rules#blk-3\)/);
});

test('一段话可以对应多个真实来源，并且引用紧贴段落出现', () => {
  const citation = buildCitationMarkdown([
    { title: '今日日记 / 块 1', blockUrl: 'https://example.com/journal#blk-1' },
    { title: '旧项目讨论 / 块 2', blockUrl: 'https://example.com/project#blk-2' },
    { title: '规则文档 / 块 5', blockUrl: 'https://example.com/rules#blk-5' },
  ], '来源');

  assert.match(citation, /^来源：/);
  assert.match(citation, /- \[今日日记 \/ 块 1\]\(https:\/\/example\.com\/journal#blk-1\)/);
  assert.match(citation, /- \[旧项目讨论 \/ 块 2\]\(https:\/\/example\.com\/project#blk-2\)/);
  assert.match(citation, /- \[规则文档 \/ 块 5\]\(https:\/\/example\.com\/rules#blk-5\)/);
});

test('索引页和每日建议仍然只做维护视图，不承担伪双链职责', () => {
  const indexMarkdown = buildAiAllPagesIndexMarkdown({
    personalEntries: [
      { topic: '日记', title: '2026-04-06 日记', url: 'https://example.com/journal', summary: '今日个人记录', isShortcut: false },
    ],
    genericEntries: [
      { topic: '项目', title: '飞书记录系统项目文档', url: 'https://example.com/project', summary: '分类与引用机制', isShortcut: false },
    ],
  });

  const adviceBlock = buildDailyAdviceBlock({
    date: '2026-04-06',
    highlights: ['今天的重点是把双链改成句段级来源引用'],
    adviceItems: {
      工作方法: ['优先按块分类，再决定是否抽取到主题文档'],
    },
    pageLinks: [
      { title: '2026-04-06 日记', url: 'https://example.com/journal' },
      { title: '飞书记录系统项目文档', url: 'https://example.com/project' },
    ],
  });

  assert.match(indexMarkdown, /## 包含个人信息/);
  assert.match(indexMarkdown, /## 不包含个人信息/);
  assert.match(adviceBlock, /### 今日建议/);
  assert.doesNotMatch(indexMarkdown, /引自：|来源：/);
  assert.doesNotMatch(adviceBlock, /引自：|来源：/);
});
