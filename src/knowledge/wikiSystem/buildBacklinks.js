export function buildBacklinksArtifact({ pages, aliases }) {
  const artifact = { version: 1, pages: {} };
  const knownPaths = new Set(pages.map((page) => page.relativePath));

  for (const page of pages) {
    artifact.pages[page.relativePath] = {
      title: page.title,
      incoming: [],
      outgoing: [],
      related: [],
    };
  }

  for (const page of pages) {
    const links = [...page.content.matchAll(/\[\[([^[\]|]+)(?:\|([^[\]]+))?\]\]/g)];

    for (const match of links) {
      const alias = match[1].trim();
      const targetPath =
        aliases[alias] ??
        aliases[alias.replace(/\.md$/, '')] ??
        (knownPaths.has(`${alias}.md`) ? `${alias}.md` : null);

      if (!targetPath) {
        artifact.pages[page.relativePath].outgoing.push(`BROKEN:${alias}`);
        continue;
      }

      artifact.pages[page.relativePath].outgoing.push(targetPath);
      artifact.pages[targetPath].incoming.push(page.relativePath);
    }
  }

  return artifact;
}
