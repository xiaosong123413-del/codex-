export function buildGraphArtifact({ pageMeta, backlinks }) {
  return {
    version: 1,
    nodes: pageMeta.pages.map((page) => ({
      id: page.path,
      label: page.title,
      category: page.category,
    })),
    edges: Object.entries(backlinks.pages).flatMap(([sourcePath, record]) =>
      record.outgoing
        .filter((targetPath) => !targetPath.startsWith('BROKEN:'))
        .map((targetPath) => ({
          source: sourcePath,
          target: targetPath,
          type: 'wikilink',
        }))
    ),
  };
}
