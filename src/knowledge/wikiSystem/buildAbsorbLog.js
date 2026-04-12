export function buildAbsorbLogArtifact({ rawEntries = [], pageMeta }) {
  const entries = {};

  for (const page of pageMeta.pages.filter((item) => item.category === '来源')) {
    const compiledInto = pageMeta.pages
      .filter((candidate) => candidate.sources.includes(page.path))
      .map((candidate) => candidate.path);

    entries[page.path] = {
      status: compiledInto.length ? 'expanded' : 'absorbed',
      sourcePage: page.path,
      compiledInto,
      lastAbsorbedAt: new Date().toISOString(),
      notes: compiledInto.length
        ? 'Source page is referenced by formal pages'
        : 'Source page exists without compiled targets yet',
      confidence: 0.8,
    };
  }

  for (const rawEntry of rawEntries) {
    if (!entries[rawEntry.relativePath]) {
      entries[rawEntry.relativePath] = {
        status: 'pending',
        sourcePage: null,
        compiledInto: [],
        lastAbsorbedAt: null,
        notes: 'Raw entry not yet backfilled into source layer',
        confidence: 0.5,
      };
    }
  }

  return {
    version: 1,
    entries,
  };
}
