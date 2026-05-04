/**
 * Peiweipedia left rail for the dedicated wiki home cover.
 *
 * The normal article reader already has a long Wikipedia-style sidebar; this
 * module gives the `wiki/index.md` cover the same persistent navigation shape.
 */
import { isWikiSourceLikePath, pageTitleFromPath, type WikiHomeTreeNode } from "./home-tree.js";
import { sortWikiSidebarTree } from "./path-order.js";

const DEFAULT_INDEX_PATH = "wiki/index.md";
const ABOUT_ME_PATH = "wiki/个人信息档案/about-me.md";

/**
 * Render the homepage sidebar using the current compiled wiki tree.
 */
export function renderWikiHomeSidebar(tree: WikiHomeTreeNode | null): string {
  return `
    <aside class="wiki-home-cover__sidebar">
      <a class="wiki-home-cover__brand" href="${wikiHref(ABOUT_ME_PATH)}">
        <div class="wiki-home-cover__mark">F</div>
        <strong>Peiweipedia</strong>
        <span>The Personal Encyclopedia</span>
      </a>
      <section class="wiki-home-cover__sidebar-section">
        <h2>Navigation</h2>
        <nav class="wiki-home-cover__sidebar-links">
          ${renderPathTree(tree, "wiki-home-cover")}
        </nav>
      </section>
    </aside>
  `;
}

function renderPathTree(tree: WikiHomeTreeNode | null, className: string): string {
  const root = findWikiContentRoot(sortWikiSidebarTree(tree));
  if (!root) {
    return `<span class="${className}__placeholder">No navigation items yet</span>`;
  }
  return `<ul class="${className}__path-tree">${renderPathNodes(root.children ?? [], className, root.path)}</ul>`;
}

function renderPathNodes(nodes: readonly WikiHomeTreeNode[], className: string, parentPath: string): string {
  return nodes.filter((node) => !isWikiSourceLikePath(node.path)).map((node) => {
    if (node.kind === "dir") {
      return `
        <li data-wiki-path-item="${escapeHtml(node.path)}" data-wiki-parent-path="${escapeHtml(parentPath)}" draggable="true">
          <details open>
            <summary data-wiki-path-node="${escapeHtml(node.path)}" title="${escapeHtml(node.path)}">
              ${escapeHtml(pageTitleFromPath(node.path, node.name))}
            </summary>
            <ul>${renderPathNodes(node.children ?? [], className, node.path)}</ul>
          </details>
        </li>
      `;
    }
    return `
      <li class="${className}__path-page" data-wiki-path-item="${escapeHtml(node.path)}" data-wiki-parent-path="${escapeHtml(parentPath)}" data-wiki-path-node="${escapeHtml(node.path)}" title="${escapeHtml(node.path)}" draggable="true">
        <a href="${wikiHref(node.path)}" title="${escapeHtml(node.path)}">${escapeHtml(pageTitleFromPath(node.name, node.name))}</a>
      </li>
    `;
  }).join("");
}

function findWikiContentRoot(tree: WikiHomeTreeNode | null): WikiHomeTreeNode | null {
  if (!tree) return null;
  if (tree.path === "wiki" && tree.kind === "dir") {
    return (tree.children ?? []).find((child) => child.path === "wiki" && child.kind === "dir") ?? tree;
  }
  return tree;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return character;
    }
  });
}

function wikiHref(path: string): string {
  return `#/wiki/${encodeURIComponent(path)}`;
}
