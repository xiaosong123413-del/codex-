import { WORKSPACE_IDS } from '../lib/workspaces.js';

type LeftSidebarProps = {
  taxonomy: { roots?: Array<{ id: string; title: string }> };
  pageMeta: { pages?: Array<{ path?: string; title?: string }> };
  selectedWorkspace: string;
};

export function LeftSidebar({ taxonomy, pageMeta, selectedWorkspace }: LeftSidebarProps) {
  return (
    <div>
      <h2>Workspace</h2>
      <ul>
        {WORKSPACE_IDS.map((workspaceId) => (
          <li key={workspaceId}>
            <a
              href={`/workspace?workspace=${workspaceId}`}
              style={{
                color: selectedWorkspace === workspaceId ? '#202122' : '#3366cc',
                fontWeight: selectedWorkspace === workspaceId ? 700 : 400,
              }}
            >
              {workspaceId}
            </a>
          </li>
        ))}
      </ul>
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
