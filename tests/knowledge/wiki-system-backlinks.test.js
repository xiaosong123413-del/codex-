import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { scanWikiPages } from '../../src/knowledge/wikiSystem/scanPages.js';
import { buildPageMetaArtifacts } from '../../src/knowledge/wikiSystem/buildPageMeta.js';

test('buildPageMetaArtifacts returns page metadata, aliases, and search index', async () => {
  const wikiRoot = path.resolve('tests/knowledge/fixtures/sample-wiki');
  const pages = await scanWikiPages({ wikiRoot });
  const artifacts = buildPageMetaArtifacts({ pages });

  assert.equal(artifacts.pageMeta.pages.length, 2);
  assert.equal(artifacts.aliases['AI知识库构建'], '概念/AI知识库构建.md');
  assert.match(
    artifacts.searchIndex.documents.find((doc) => doc.path === '概念/AI知识库构建.md').text,
    /OpenClaw/
  );
});
