function extractHeadings(content) {
  return content
    .split('\n')
    .filter((line) => line.startsWith('#'))
    .map((line) => line.replace(/^#+\s*/, '').trim())
    .filter(Boolean);
}

function extractWikilinks(content) {
  return [...content.matchAll(/\[\[([^[\]|]+)(?:\|([^[\]]+))?\]\]/g)].map((match) => ({
    target: match[1].trim(),
    label: (match[2] ?? match[1]).trim(),
  }));
}

export function buildPageMetaArtifacts({ pages }) {
  const pageRecords = pages.map((page) => {
    const aliases = [
      page.title,
      ...(Array.isArray(page.frontmatter.aliases) ? page.frontmatter.aliases : []),
    ];

    return {
      path: page.relativePath,
      title: page.title,
      category: page.category,
      aliases,
      tags: Array.isArray(page.frontmatter.tags) ? page.frontmatter.tags : [],
      sources: Array.isArray(page.frontmatter.sources) ? page.frontmatter.sources : [],
      headings: extractHeadings(page.content),
      outgoingHints: extractWikilinks(page.content),
      abstract: page.content.split('\n').find((line) => line.trim()) ?? '',
      updated: page.frontmatter.updated ?? page.frontmatter.created ?? null,
    };
  });

  const aliases = Object.fromEntries(
    pageRecords.flatMap((page) => page.aliases.map((alias) => [alias, page.path]))
  );

  const searchIndex = {
    documents: pageRecords.map((page, index) => ({
      path: page.path,
      title: page.title,
      category: page.category,
      text: [page.title, ...page.aliases, page.abstract, ...page.headings, pages[index].content]
        .join(' ')
        .trim(),
      tags: page.tags,
    })),
  };

  return {
    pageMeta: {
      version: 1,
      pages: pageRecords,
    },
    aliases,
    searchIndex,
  };
}
