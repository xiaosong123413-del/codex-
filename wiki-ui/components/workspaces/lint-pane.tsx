type LintPaneProps = {
  lint: { brokenLinks?: Array<{ from?: string; target?: string }>; orphanPages?: Array<string> };
};

export function LintPane({ lint }: LintPaneProps) {
  return (
    <section className="workspace-section">
      <p className="workspace-kicker">Lint</p>
      <h1 className="workspace-title">Knowledge Quality</h1>
      <div className="workspace-grid-two">
        <div className="workspace-card">
          <h3>Broken Links</h3>
          <p>{lint.brokenLinks?.length ?? 0}</p>
          <ul className="workspace-list">
            {(lint.brokenLinks ?? []).slice(0, 12).map((entry, index) => (
              <li key={`${entry.from}-${entry.target}-${index}`}>
                <strong>{entry.from}</strong>
                <div className="workspace-muted">{entry.target}</div>
              </li>
            ))}
          </ul>
        </div>
        <div className="workspace-card">
          <h3>Orphan Pages</h3>
          <p>{lint.orphanPages?.length ?? 0}</p>
          <ul className="workspace-list">
            {(lint.orphanPages ?? []).slice(0, 12).map((pagePath) => (
              <li key={pagePath}>{pagePath}</li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
