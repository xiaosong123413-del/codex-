import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildGenericKnowledgeMarkdown,
  buildPersonalKnowledgeMarkdown,
  classifyKnowledgeContent,
} from '../../src/knowledge/aiWiki.js';

test('classifyKnowledgeContent handles real Chinese mixed input', () => {
  const result = classifyKnowledgeContent({
    content: '今天我因为飞书记录系统这件事有点烦，但我后来想明白了，问题不在模板，而在内容分类和引用机制没有分开设计。',
  });

  assert.equal(result.type, 'mixed');
});

test('knowledge markdown uses inline citations instead of related-page sections', () => {
  const personalMarkdown = buildPersonalKnowledgeMarkdown({
    title: '2026-04-06 日记',
    entries: [
      {
        text: '今天继续按之前定下来的规则整理记录系统。',
        citations: [
          {
            label: '来源',
            title: '飞书记录系统设计规则 / blk-3',
            blockUrl: 'https://example.com/rules#blk-3',
          },
        ],
      },
    ],
    relatedGenericPages: [
      {
        title: '飞书记录系统',
        url: 'https://example.com/wiki/project-doc',
      },
    ],
  });

  const genericMarkdown = buildGenericKnowledgeMarkdown({
    title: '飞书记录系统',
    entries: [
      {
        text: '系统的核心问题不在模板，而在内容分类和引用机制没有分开设计。',
        citations: [
          {
            label: '引自',
            title: '2026-04-06 日记 / blk-2',
            blockUrl: 'https://example.com/journal#blk-2',
          },
        ],
      },
    ],
    relatedPersonalPages: [
      {
        title: '2026-04-06 日记',
        url: 'https://example.com/wiki/journal-doc',
      },
    ],
  });

  assert.doesNotMatch(personalMarkdown, /关联文档/);
  assert.doesNotMatch(genericMarkdown, /关联文档/);
  assert.match(personalMarkdown, /来源：\[飞书记录系统设计规则 \/ blk-3\]\(https:\/\/example\.com\/rules#blk-3\)/);
  assert.match(genericMarkdown, /引自：\[2026-04-06 日记 \/ blk-2\]\(https:\/\/example\.com\/journal#blk-2\)/);
  assert.doesNotMatch(personalMarkdown, /project-doc/);
  assert.doesNotMatch(genericMarkdown, /journal-doc/);
});
