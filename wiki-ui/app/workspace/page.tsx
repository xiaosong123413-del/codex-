import { AppShell } from '../../components/app-shell.js';
import { LeftSidebar } from '../../components/left-sidebar';
import { PreviewPane } from '../../components/preview-pane';
import { RightContextPanel } from '../../components/right-context-panel';
import { ChatPane } from '../../components/workspaces/chat-pane';
import { GraphPane } from '../../components/workspaces/graph-pane';
import { LintPane } from '../../components/workspaces/lint-pane';
import { ResearchPane } from '../../components/workspaces/research-pane';
import { ReviewPane } from '../../components/workspaces/review-pane';
import { SearchPane } from '../../components/workspaces/search-pane';
import { SourcesPane } from '../../components/workspaces/sources-pane';
import { WikiPane } from '../../components/workspaces/wiki-pane';
import {
  loadAbsorbLog,
  loadBacklinks,
  loadGraph,
  loadLint,
  loadPageMeta,
  loadSearchIndex,
  loadTaxonomy,
} from '../../lib/generated/loaders.js';
import { resolveWorkspace } from '../../lib/workspaces.js';

type WorkspacePageMeta = {
  pages?: Array<{ title?: string; path?: string; abstract?: string }>;
};

type WorkspaceGraph = {
  nodes?: Array<unknown>;
  edges?: Array<unknown>;
};

type WorkspaceLint = {
  brokenLinks?: Array<unknown>;
  orphanPages?: Array<unknown>;
};

type WorkspaceSearchIndex = {
  documents?: Array<{ path?: string; title?: string }>;
};

type RenderWorkspacePanelArgs = {
  workspace: string;
  pageMeta: WorkspacePageMeta;
  activePage: { title?: string; path?: string; abstract?: string } | null;
  graph: WorkspaceGraph;
  lint: WorkspaceLint;
  searchIndex: WorkspaceSearchIndex;
};

function renderWorkspacePanel({
  workspace,
  pageMeta,
  activePage,
  graph,
  lint,
  searchIndex,
}: RenderWorkspacePanelArgs) {
  switch (workspace) {
    case 'sources':
      return <SourcesPane />;
    case 'search':
      return <SearchPane searchIndex={searchIndex} />;
    case 'graph':
      return <GraphPane graph={graph} />;
    case 'lint':
      return <LintPane lint={lint} />;
    case 'review':
      return <ReviewPane />;
    case 'research':
      return <ResearchPane />;
    case 'chat':
      return <ChatPane />;
    case 'wiki':
    default:
      return <WikiPane pageMeta={pageMeta} activePage={activePage} />;
  }
}

type WorkspacePageProps = {
  searchParams?: Promise<{ workspace?: string }>;
};

export default async function WorkspacePage({ searchParams }: WorkspacePageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const workspace = resolveWorkspace(resolvedSearchParams?.workspace);
  const [taxonomy, pageMeta, backlinks, absorbLog, graph, lint, searchIndex] = await Promise.all([
    loadTaxonomy(),
    loadPageMeta(),
    loadBacklinks(),
    loadAbsorbLog(),
    loadGraph(),
    loadLint(),
    loadSearchIndex(),
  ]);

  const activePage = pageMeta.pages?.[0] ?? null;

  return (
    <AppShell
      selectedWorkspace={workspace}
      leftSidebar={
        <LeftSidebar
          taxonomy={taxonomy}
          pageMeta={pageMeta}
          selectedWorkspace={workspace}
        />
      }
      mainPanel={renderWorkspacePanel({ workspace, pageMeta, activePage, graph, lint, searchIndex })}
      rightPanel={
        <RightContextPanel
          activePage={activePage}
          backlinks={activePage ? backlinks.pages?.[activePage.path] ?? null : null}
          absorbRecord={activePage ? absorbLog.entries?.[activePage.path] ?? null : null}
        >
          <PreviewPane activePage={activePage} />
        </RightContextPanel>
      }
    />
  );
}
