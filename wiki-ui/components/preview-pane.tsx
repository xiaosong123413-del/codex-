type PreviewPaneProps = {
  activePage: {
    title?: string;
    path?: string;
    abstract?: string;
    headings?: string[];
    searchableTags?: string[];
    text?: string;
    sources?: string[];
  } | null;
};

export function PreviewPane({ activePage }: PreviewPaneProps) {
  if (!activePage) {
    return <div>No preview available.</div>;
  }

  return (
    <article className="workspace-article">
      <h2>{activePage.title}</h2>
      <p className="workspace-muted">{activePage.path}</p>
      {activePage.abstract ? <p>{activePage.abstract}</p> : null}
      {activePage.searchableTags?.length ? (
        <div>
          {activePage.searchableTags.slice(0, 6).map((tag) => (
            <span className="workspace-pill" key={tag}>
              {tag}
            </span>
          ))}
        </div>
      ) : null}
      {activePage.headings?.length ? (
        <>
          <h3>Headings</h3>
          <ul className="workspace-list">
            {activePage.headings.slice(0, 8).map((heading) => (
              <li key={heading}>{heading}</li>
            ))}
          </ul>
        </>
      ) : null}
      {activePage.sources?.length ? (
        <>
          <h3>Sources</h3>
          <ul className="workspace-list">
            {activePage.sources.map((source) => (
              <li key={source}>{source}</li>
            ))}
          </ul>
        </>
      ) : null}
      {activePage.text ? (
        <>
          <h3>Body</h3>
          <div className="workspace-article-text">{activePage.text.slice(0, 4000)}</div>
        </>
      ) : null}
    </article>
  );
}
