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
import { resolveActivePage, searchKnowledge } from '../../lib/knowledge.js';
import { resolveWorkspace } from '../../lib/workspaces.js';

type WorkspacePageMeta = {
  pages?: Array<{
    title?: string;
    path?: string;
    abstract?: string;
    category?: string;
    headings?: string[];
    tags?: string[];
    sources?: string[];
  }>;
};

type WorkspaceGraph = {
  nodes?: Array<{ id?: string; label?: string; category?: string }>;
  edges?: Array<{ source?: string; target?: string }>;
};

type WorkspaceLint = {
  brokenLinks?: Array<{ from?: string; target?: string }>;
  orphanPages?: Array<string>;
};

type WorkspaceSearchIndex = {
  documents?: Array<{ path?: string; title?: string; category?: string; text?: string; tags?: string[] }>;
};

type RenderWorkspacePanelArgs = {
  workspace: string;
  pageMeta: WorkspacePageMeta;
  activePage: { title?: string; path?: string; abstract?: string; text?: string } | null;
  graph: WorkspaceGraph;
  lint: WorkspaceLint;
  searchIndex: WorkspaceSearchIndex;
  searchQuery?: string;
  searchResults: Array<{ path?: string; title?: string; category?: string; score?: number }>;
  sourcePages: Array<{ path?: string; title?: string; abstract?: string }>;
};

function renderWorkspacePanel({
  workspace,
  pageMeta,
  activePage,
  graph,
  lint,
  searchQuery,
  searchResults,
  sourcePages,
}: RenderWorkspacePanelArgs) {
  switch (workspace) {
    case 'sources':
      return <SourcesPane sourcePages={sourcePages} selectedPath={activePage?.path} />;
    case 'search':
      return <SearchPane query={searchQuery} results={searchResults} />;
    case 'graph':
      return <GraphPane graph={graph} />;
    case 'lint':
      return <LintPane lint={lint} />;
    case 'review':
      return <ReviewPane />;
    case 'research':
      return <ResearchPane />;
    case 'chat':
      return <ChatPane activePagePath={activePage?.path} />;
    case 'wiki':
    default:
      return <WikiPane pageMeta={pageMeta} activePage={activePage} />;
  }
}

type WorkspacePageProps = {
  searchParams?: Promise<{ workspace?: string; page?: string; q?: string }>;
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

  const activePage = resolveActivePage({
    pageMeta,
    searchIndex,
    requestedPath: resolvedSearchParams?.page,
    preferredCategory: workspace === 'sources' ? '来源' : undefined,
  });
  const searchQuery = resolvedSearchParams?.q?.trim() ?? '';
  const searchResults = searchKnowledge({
    searchIndex,
    query: searchQuery || activePage?.title || '',
    limit: 16,
  });
  const sourcePages = (pageMeta.pages ?? []).filter(
    (page: NonNullable<WorkspacePageMeta['pages']>[number]) =>
      page.category === '来源' || page.path?.startsWith('来源/')
  );
  const activePagePath = activePage?.path;

  return (
    <AppShell
      selectedWorkspace={workspace}
      leftSidebar={
        <LeftSidebar
          taxonomy={taxonomy}
          pageMeta={pageMeta}
          selectedWorkspace={workspace}
          selectedPagePath={activePage?.path ?? null}
        />
      }
      mainPanel={renderWorkspacePanel({
        workspace,
        pageMeta,
        activePage,
        graph,
        lint,
        searchIndex,
        searchQuery,
        searchResults,
        sourcePages,
      })}
      rightPanel={
        <RightContextPanel
          activePage={activePage}
          backlinks={activePagePath ? backlinks.pages?.[activePagePath] ?? null : null}
          absorbRecord={activePagePath ? absorbLog.entries?.[activePagePath] ?? null : null}
        >
          <PreviewPane activePage={activePage} />
        </RightContextPanel>
      }
    />
  );
}
