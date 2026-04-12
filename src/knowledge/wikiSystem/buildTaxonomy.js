export function buildTaxonomyArtifact({ pageMeta }) {
  const groups = new Map();

  for (const page of pageMeta.pages) {
    if (!groups.has(page.category)) {
      groups.set(page.category, []);
    }

    groups.get(page.category).push(page.path);
  }

  return {
    version: 1,
    roots: [...groups.entries()].map(([title, pages]) => ({
      id: title,
      title,
      children: [
        {
          id: `${title}-pages`,
          title: `${title} Pages`,
          pages,
        },
      ],
    })),
  };
}
