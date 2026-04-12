type WikiPaneProps = {
  pageMeta: { pages?: Array<{ title?: string; path?: string; category?: string }> };
  activePage: { title?: string; path?: string; text?: string; abstract?: string } | null;
};

export function WikiPane({ pageMeta, activePage }: WikiPaneProps) {
  return (
    <section className="workspace-section">
      <p className="workspace-kicker">Wiki</p>
      <h1 className="workspace-title">{activePage?.title ?? 'No page selected'}</h1>
      {activePage?.abstract ? <p>{activePage.abstract}</p> : null}
      {activePage?.text ? <div className="workspace-article-text">{activePage.text.slice(0, 5000)}</div> : null}
      <h3 style={{ marginTop: 24 }}>Linked Reading</h3>
      <ul className="workspace-list">
        {(pageMeta.pages ?? []).slice(0, 12).map((page) => (
          <li key={page.path}>
            <a href={`/workspace?workspace=wiki&page=${encodeURIComponent(page.path ?? '')}`}>
              {page.title}
            </a>
            <span className="workspace-muted"> {page.category ? `· ${page.category}` : ''}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
