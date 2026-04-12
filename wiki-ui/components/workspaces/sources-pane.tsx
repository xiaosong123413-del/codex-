type SourcesPaneProps = {
  sourcePages: Array<{ path?: string; title?: string; abstract?: string }>;
  selectedPath?: string | null;
};

export function SourcesPane({ sourcePages, selectedPath }: SourcesPaneProps) {
  return (
    <section className="workspace-section">
      <p className="workspace-kicker">Sources</p>
      <h1 className="workspace-title">Source Pages</h1>
      <ul className="workspace-list">
        {sourcePages.slice(0, 40).map((page) => (
          <li key={page.path}>
            <a
              href={`/workspace?workspace=sources&page=${encodeURIComponent(page.path ?? '')}`}
              className={selectedPath === page.path ? 'workspace-link-active' : undefined}
            >
              {page.title}
            </a>
            {page.abstract ? <div className="workspace-muted">{page.abstract}</div> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
