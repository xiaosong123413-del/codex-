type SearchPaneProps = {
  query?: string;
  results: Array<{ path?: string; title?: string; category?: string; score?: number }>;
};

export function SearchPane({ query, results }: SearchPaneProps) {
  return (
    <section className="workspace-section">
      <p className="workspace-kicker">Search</p>
      <h1 className="workspace-title">Knowledge Search</h1>
      <form action="/workspace" method="get" className="workspace-form">
        <input type="hidden" name="workspace" value="search" />
        <input
          className="workspace-input"
          type="search"
          name="q"
          defaultValue={query ?? ''}
          placeholder="Search pages, titles, tags, sources"
        />
        <button className="workspace-button" type="submit">
          Search
        </button>
      </form>
      <div style={{ marginTop: 20 }}>
        <p className="workspace-muted">Results: {results.length}</p>
        <ul className="workspace-list">
          {results.map((result) => (
            <li key={result.path}>
              <a href={`/workspace?workspace=wiki&page=${encodeURIComponent(result.path ?? '')}`}>
                {result.title}
              </a>
              <span className="workspace-muted">
                {result.category ? ` · ${result.category}` : ''}
                {typeof result.score === 'number' ? ` · score ${result.score}` : ''}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
