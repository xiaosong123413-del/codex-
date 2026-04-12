type LeftSidebarProps = {
  taxonomy: { roots?: Array<{ id: string; title: string }> };
  pageMeta: { pages?: Array<{ path: string; title: string }> };
};

export function LeftSidebar({ taxonomy, pageMeta }: LeftSidebarProps) {
  return (
    <div>
      <h2>Workspace</h2>
      <p>Wiki / Sources / Search / Graph / Lint</p>
      <h3>Taxonomy</h3>
      <ul>
        {(taxonomy.roots ?? []).slice(0, 8).map((node) => (
          <li key={node.id}>{node.title}</li>
        ))}
      </ul>
      <h3>Pages</h3>
      <ul>
        {(pageMeta.pages ?? []).slice(0, 8).map((page) => (
          <li key={page.path}>{page.title}</li>
        ))}
      </ul>
    </div>
  );
}
