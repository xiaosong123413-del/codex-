export function buildLintArtifact({ pageMeta, backlinks }) {
  const brokenLinks = [];
  const orphanPages = [];

  for (const [pagePath, record] of Object.entries(backlinks.pages)) {
    for (const outgoing of record.outgoing) {
      if (outgoing.startsWith('BROKEN:')) {
        brokenLinks.push({
          from: pagePath,
          target: outgoing.replace('BROKEN:', ''),
        });
      }
    }

    if (record.incoming.length === 0) {
      orphanPages.push(pagePath);
    }
  }

  return {
    version: 1,
    brokenLinks,
    orphanPages,
    weaklyConnectedPages: [],
    duplicateCandidates: [],
    missingSources: pageMeta.pages.filter(
      (page) => page.category !== '来源' && page.sources.length === 0
    ),
  };
}
