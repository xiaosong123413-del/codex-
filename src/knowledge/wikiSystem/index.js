import { resolveWikiSystemConfig } from './config.js';
import { scanWikiPages } from './scanPages.js';
import { buildPageMetaArtifacts } from './buildPageMeta.js';
import { buildBacklinksArtifact } from './buildBacklinks.js';
import { buildTaxonomyArtifact } from './buildTaxonomy.js';
import { buildGraphArtifact } from './buildGraph.js';
import { buildLintArtifact } from './buildLintReport.js';
import { buildAbsorbLogArtifact } from './buildAbsorbLog.js';
import { writeArtifacts } from './writeArtifacts.js';

export async function generateWikiSystem(overrides = {}) {
  const config = resolveWikiSystemConfig(overrides);
  const pages = await scanWikiPages(config);
  const meta = buildPageMetaArtifacts({ pages });
  const backlinks = buildBacklinksArtifact({ pages, aliases: meta.aliases });
  const taxonomy = buildTaxonomyArtifact({ pageMeta: meta.pageMeta, backlinks });
  const graph = buildGraphArtifact({ pageMeta: meta.pageMeta, backlinks });
  const lint = buildLintArtifact({ pageMeta: meta.pageMeta, backlinks });
  const absorbLog = buildAbsorbLogArtifact({ rawEntries: [], pageMeta: meta.pageMeta });

  await writeArtifacts({
    systemDir: config.systemDir,
    artifacts: {
      'page-meta.json': meta.pageMeta,
      'aliases.json': meta.aliases,
      'search-index.json': meta.searchIndex,
      '_backlinks.json': backlinks,
      'taxonomy.json': taxonomy,
      'graph.json': graph,
      'lint-report.json': lint,
      '_absorb_log.json': absorbLog,
    },
  });
}
