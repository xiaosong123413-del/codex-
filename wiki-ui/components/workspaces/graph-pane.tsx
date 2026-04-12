type GraphPaneProps = {
  graph: { nodes?: Array<unknown>; edges?: Array<unknown> };
};

export function GraphPane({ graph }: GraphPaneProps) {
  return (
    <section>
      <h1>Graph</h1>
      <p>Nodes: {graph.nodes?.length ?? 0}</p>
      <p>Edges: {graph.edges?.length ?? 0}</p>
    </section>
  );
}
