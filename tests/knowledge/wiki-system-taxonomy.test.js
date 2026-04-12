import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { scanWikiPages } from '../../src/knowledge/wikiSystem/scanPages.js';
import { buildPageMetaArtifacts } from '../../src/knowledge/wikiSystem/buildPageMeta.js';
import { buildBacklinksArtifact } from '../../src/knowledge/wikiSystem/buildBacklinks.js';
import { buildTaxonomyArtifact } from '../../src/knowledge/wikiSystem/buildTaxonomy.js';
import { buildGraphArtifact } from '../../src/knowledge/wikiSystem/buildGraph.js';
import { buildLintArtifact } from '../../src/knowledge/wikiSystem/buildLintReport.js';

test('derived graph artifacts expose backlinks, taxonomy, and lint records', async () => {
  const wikiRoot = path.resolve('tests/knowledge/fixtures/sample-wiki');
  const pages = await scanWikiPages({ wikiRoot });
  const meta = buildPageMetaArtifacts({ pages });
  const backlinks = buildBacklinksArtifact({ pages, aliases: meta.aliases });
  const taxonomy = buildTaxonomyArtifact({ pageMeta: meta.pageMeta, backlinks });
  const graph = buildGraphArtifact({ pageMeta: meta.pageMeta, backlinks });
  const lint = buildLintArtifact({ pageMeta: meta.pageMeta, backlinks });

  assert.deepEqual(backlinks.pages['来源/2026-04-12-样例来源.md'].incoming, ['概念/AI知识库构建.md']);
  assert.equal(taxonomy.roots[0].title, '概念');
  assert.equal(graph.edges[0].type, 'wikilink');
  assert.equal(lint.brokenLinks.length, 1);
});
