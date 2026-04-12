import { AppShell } from '../../components/app-shell.js';
import { LeftSidebar } from '../../components/left-sidebar';
import { PreviewPane } from '../../components/preview-pane';
import { RightContextPanel } from '../../components/right-context-panel';
import { WikiPane } from '../../components/workspaces/wiki-pane';
import {
  loadAbsorbLog,
  loadBacklinks,
  loadPageMeta,
  loadTaxonomy,
} from '../../lib/generated/loaders.js';

export default async function WorkspacePage() {
  const [taxonomy, pageMeta, backlinks, absorbLog] = await Promise.all([
    loadTaxonomy(),
    loadPageMeta(),
    loadBacklinks(),
    loadAbsorbLog(),
  ]);

  const activePage = pageMeta.pages?.[0] ?? null;

  return (
    <AppShell
      selectedWorkspace="wiki"
      leftSidebar={<LeftSidebar taxonomy={taxonomy} pageMeta={pageMeta} />}
      mainPanel={<WikiPane pageMeta={pageMeta} activePage={activePage} />}
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
