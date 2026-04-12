import test from 'node:test';
import assert from 'node:assert/strict';

import { buildAbsorbLogArtifact } from '../../src/knowledge/wikiSystem/buildAbsorbLog.js';

test('buildAbsorbLogArtifact maps source pages into formal pages with status', () => {
  const artifact = buildAbsorbLogArtifact({
    rawEntries: [{ relativePath: 'raw/demo.md' }],
    pageMeta: {
      pages: [
        {
          path: '来源/2026-04-12-样例来源.md',
          category: '来源',
          title: '2026-04-12-样例来源',
          sources: [],
        },
        {
          path: '概念/AI知识库构建.md',
          category: '概念',
          title: 'AI知识库构建',
          sources: ['来源/2026-04-12-样例来源.md'],
        },
      ],
    },
  });

  assert.equal(artifact.entries['来源/2026-04-12-样例来源.md'].status, 'expanded');
  assert.deepEqual(artifact.entries['来源/2026-04-12-样例来源.md'].compiledInto, ['概念/AI知识库构建.md']);
});
