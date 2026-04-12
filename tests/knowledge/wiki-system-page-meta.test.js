import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { scanWikiPages } from '../../src/knowledge/wikiSystem/scanPages.js';

test('scanWikiPages returns markdown pages with normalized category and title', async () => {
  const wikiRoot = path.resolve('tests/knowledge/fixtures/sample-wiki');
  const pages = await scanWikiPages({ wikiRoot });

  assert.equal(pages.length, 2);
  assert.deepEqual(
    pages.map((page) => ({
      relativePath: page.relativePath,
      category: page.category,
      title: page.title,
    })),
    [
      {
        relativePath: '概念/AI知识库构建.md',
        category: '概念',
        title: 'AI知识库构建',
      },
      {
        relativePath: '来源/2026-04-12-样例来源.md',
        category: '来源',
        title: '2026-04-12-样例来源',
      },
    ]
  );
});
