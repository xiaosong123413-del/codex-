import type { Route } from "../router.js";
import { renderFlashDiaryPage } from "../pages/flash-diary/index.js";
import { renderGraphPage } from "../pages/graph/index.js";
import { renderReviewPage } from "../pages/review/index.js";
import { renderRunPage } from "../pages/runs/index.js";
import { renderSettingsPage } from "../pages/settings/index.js";
import { renderSourcesPage } from "../pages/sources/index.js";
import { renderWikiPage } from "../pages/wiki/index.js";
import { renderAutomationLogPage, renderAutomationWorkspacePage } from "../pages/automation/index.js";
import { renderWorkflowArtifactsPage } from "../pages/workflow-artifacts/index.js";
import { renderWorkspacePage } from "../pages/workspace/index.js";
import { renderPlaceholder } from "./placeholder.js";

type RouteName = Route["name"];

interface MainSlotOptions {
  container: HTMLElement;
  legacyChatNode: HTMLElement;
  legacyBrowser: HTMLElement;
  isChatBrowserCollapsed?: () => boolean;
  onOpenKnowledgePreview?: (path: string) => void;
}

interface MainSlotHandle {
  render(route: Route): void;
}

type DisposableNode = HTMLElement & {
  __dispose?: () => void;
};

const BROWSERLESS_ROUTES: ReadonlySet<RouteName> = new Set([
  "workspace",
  "settings",
  "review",
  "graph",
  "wiki",
  "sources",
  "project-log",
  "flash-diary",
  "automation",
  "automation-log",
  "workflow-artifacts",
  "check",
  "sync",
]);

const FULL_PAGE_ROUTES: ReadonlySet<RouteName> = new Set([
  "workspace",
  "settings",
  "review",
  "graph",
  "wiki",
  "sources",
  "project-log",
  "flash-diary",
  "automation",
  "automation-log",
  "workflow-artifacts",
]);

export function createMainSlot(options: MainSlotOptions): MainSlotHandle {
  const { container, legacyChatNode, legacyBrowser } = options;
  const shellRoot = container.closest<HTMLElement>("#workspace-shell");

  return {
    render(route) {
      disposeCurrent(container);
      const hideBrowser = shouldHideBrowser(route, options);
      const fullPage = isFullPageRoute(route.name);
      updateShellState(shellRoot, route.name, fullPage, hideBrowser);
      legacyBrowser.hidden = hideBrowser;
      if (route.name === "chat") {
        showLegacyChat(container, legacyChatNode);
        return;
      }

      legacyChatNode.hidden = true;
      container.replaceChildren(renderRoutePage(route, options));
    },
  };
}

function disposeCurrent(container: HTMLElement): void {
  const current = container.firstElementChild as DisposableNode | null;
  current?.__dispose?.();
}

function shouldHideBrowser(route: Route, options: MainSlotOptions): boolean {
  if (route.name === "chat") {
    return options.isChatBrowserCollapsed?.() ?? false;
  }
  return BROWSERLESS_ROUTES.has(route.name);
}

function isFullPageRoute(routeName: RouteName): boolean {
  return FULL_PAGE_ROUTES.has(routeName);
}

function updateShellState(
  shellRoot: HTMLElement | null,
  routeName: RouteName,
  fullPage: boolean,
  hideBrowser: boolean,
): void {
  shellRoot?.setAttribute("data-route", routeName);
  shellRoot?.toggleAttribute("data-full-page", fullPage);
  shellRoot?.toggleAttribute("data-browser-hidden", hideBrowser);
}

function showLegacyChat(container: HTMLElement, legacyChatNode: HTMLElement): void {
  legacyChatNode.hidden = false;
  container.replaceChildren(legacyChatNode);
}

// fallow-ignore-next-line complexity
function renderRoutePage(route: Route, options: MainSlotOptions): HTMLElement {
  switch (route.name) {
    case "check":
    case "sync":
      return renderRunPage(route.name);
    case "workspace":
      return renderWorkspacePage({
        routeSection: route.params.section,
        onOpenKnowledgePreview: options.onOpenKnowledgePreview,
      });
    case "automation":
      return renderAutomationWorkspacePage(route.params.id);
    case "automation-log":
      return renderAutomationLogPage(route.params.id);
    case "workflow-artifacts":
      return renderWorkflowArtifactsPage();
    case "review":
      return renderReviewPage();
    case "flash-diary":
      return renderFlashDiaryPage();
    case "sources":
      return renderSourcesPage();
    case "graph":
      return renderGraphPage();
    case "wiki":
      return renderWikiPage(route.params.path, route.anchor);
    case "project-log":
      return renderSettingsPage("project-log");
    case "settings":
      return renderSettingsPage(route.params.section, { anchor: route.anchor });
    default:
      return renderPlaceholder(route.name);
  }
}
