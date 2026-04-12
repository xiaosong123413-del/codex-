type GraphPaneProps = {
  graph: { nodes?: Array<{ id?: string; label?: string; category?: string }>; edges?: Array<{ source?: string; target?: string }> };
};

export function GraphPane({ graph }: GraphPaneProps) {
  const topNodes = (graph.nodes ?? []).slice(0, 12);
  return (
    <section className="workspace-section">
      <p className="workspace-kicker">Graph</p>
      <h1 className="workspace-title">Knowledge Graph</h1>
      <div className="workspace-grid-two">
        <div className="workspace-card">
          <h3>Graph Size</h3>
          <p>Nodes: {graph.nodes?.length ?? 0}</p>
          <p>Edges: {graph.edges?.length ?? 0}</p>
        </div>
        <div className="workspace-card">
          <h3>Visible Nodes</h3>
          <ul className="workspace-list">
            {topNodes.map((node) => (
              <li key={node.id}>
                {node.label}
                <span className="workspace-muted">{node.category ? ` · ${node.category}` : ''}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
