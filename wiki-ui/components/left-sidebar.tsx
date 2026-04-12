import { WORKSPACE_IDS } from '../lib/workspaces.js';

type LeftSidebarProps = {
  taxonomy: {
    roots?: Array<{
      id: string;
      title: string;
      children?: Array<{ id: string; title: string; pages?: string[] }>;
    }>;
  };
  pageMeta: { pages?: Array<{ path?: string; title?: string }> };
  selectedWorkspace: string;
  selectedPagePath?: string | null;
};

const workspaceLabels: Record<string, string> = {
  wiki: 'Wiki',
  sources: 'Sources',
  search: 'Search',
  graph: 'Graph',
  lint: 'Lint',
  review: 'Review',
  research: 'Deep Research',
  chat: 'Chat',
};

export function LeftSidebar({
  taxonomy,
  pageMeta,
  selectedWorkspace,
  selectedPagePath,
}: LeftSidebarProps) {
  return (
    <div>
      <p className="workspace-kicker">Second Brain</p>
      <h2 className="workspace-title">Workspace</h2>
      <ul className="workspace-nav">
        {WORKSPACE_IDS.map((workspaceId) => (
          <li key={workspaceId}>
            <a
              href={`/workspace?workspace=${workspaceId}`}
              className={selectedWorkspace === workspaceId ? 'workspace-link-active' : undefined}
            >
              {workspaceLabels[workspaceId] ?? workspaceId}
            </a>
          </li>
        ))}
      </ul>

      <div className="workspace-section" style={{ marginTop: 20 }}>
        <h3 className="workspace-title">Taxonomy</h3>
        <ul className="workspace-list">
          {(taxonomy.roots ?? []).slice(0, 8).map((node) => (
            <li key={node.id}>
              <strong>{node.title}</strong>
              {node.children?.[0]?.pages?.length ? (
                <div className="workspace-muted" style={{ marginTop: 4 }}>
                  {node.children[0].pages.length} pages
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </div>

      <div className="workspace-section" style={{ marginTop: 16 }}>
        <h3 className="workspace-title">Recent Pages</h3>
        <ul className="workspace-list">
          {(pageMeta.pages ?? []).slice(0, 10).map((page) => (
            <li key={page.path}>
              <a
                href={`/workspace?workspace=wiki&page=${encodeURIComponent(page.path ?? '')}`}
                className={selectedPagePath === page.path ? 'workspace-link-active' : undefined}
              >
                {page.title}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
