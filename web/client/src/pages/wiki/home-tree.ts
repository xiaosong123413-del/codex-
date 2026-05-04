/**
 * Wiki home tree helpers.
 *
 * This module keeps the `wiki/index.md` cover page focused on rendering while
 * centralizing the small amount of tree traversal needed for navigation,
 * recent pages, and category sections.
 */
export interface WikiHomeTreeNode {
  name: string;
  path: string;
  kind: "file" | "dir";
  modifiedAt?: string;
  children?: WikiHomeTreeNode[];
}

export interface WikiHomePageLink {
  path: string;
  title: string;
  modifiedAt: string | null;
}

export interface WikiHomeCategoryGroup {
  name: string;
  pages: WikiHomePageLink[];
}

const PRIORITY_CATEGORY_NAMES = ["个人信息档案"];
const SOURCE_LIKE_WIKI_PATHS = new Set(["wiki/聊天记录"]);

/**
 * Return every file node as a displayable wiki page link.
 */
export function flattenWikiTree(tree: WikiHomeTreeNode | null): WikiHomePageLink[] {
  const pages: WikiHomePageLink[] = [];
  visitWikiTree(tree, (node) => {
    if (node.kind !== "file" || isWikiSourceLikePath(node.path)) {
      return;
    }
    pages.push({
      path: node.path,
      title: pageTitleFromPath(node.name, node.name),
      modifiedAt: node.modifiedAt ?? null,
    });
  });
  return pages;
}

/**
 * Return the top-level wiki folders that should become homepage categories.
 */
export function collectWikiCategoryGroups(tree: WikiHomeTreeNode | null): WikiHomeTreeNode[] {
  const wikiRoot = findWikiContentRoot(tree);
  return (wikiRoot?.children ?? []).filter((child) => child.kind === "dir" && !isWikiSourceLikePath(child.path));
}

export function isWikiSourceLikePath(path: string): boolean {
  return Array.from(SOURCE_LIKE_WIKI_PATHS).some((sourcePath) => path === sourcePath || path.startsWith(`${sourcePath}/`));
}

/**
 * Build compact category panels from wiki folders.
 */
export function buildCategoryGroups(
  tree: WikiHomeTreeNode | null,
  maxGroups: number,
  maxItems: number,
): WikiHomeCategoryGroup[] {
  return collectWikiCategoryGroups(tree)
    .sort(compareCategoryGroups)
    .slice(0, maxGroups)
    .map((group) => ({
      name: pageTitleFromPath(group.path, group.name),
      pages: (group.children ?? [])
        .filter((child) => child.kind === "file")
        .slice(0, maxItems)
        .map((child) => ({
          path: child.path,
          title: pageTitleFromPath(child.name, child.name),
          modifiedAt: child.modifiedAt ?? null,
        })),
    }));
}

function compareCategoryGroups(left: WikiHomeTreeNode, right: WikiHomeTreeNode): number {
  const leftIndex = PRIORITY_CATEGORY_NAMES.indexOf(pageTitleFromPath(left.path, left.name));
  const rightIndex = PRIORITY_CATEGORY_NAMES.indexOf(pageTitleFromPath(right.path, right.name));
  if (leftIndex !== rightIndex) {
    return normalizePriority(leftIndex) - normalizePriority(rightIndex);
  }
  return left.name.localeCompare(right.name);
}

function normalizePriority(index: number): number {
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

/**
 * Convert a wiki file or folder path into a readable title.
 */
export function pageTitleFromPath(path: string, fallback: string): string {
  const base = path.split("/").pop() ?? fallback;
  return base
    .replace(/\.(md|markdown|txt)$/iu, "")
    .replace(/[-_]+/gu, " ")
    .replace(/\b\w/gu, (char) => char.toUpperCase());
}

/**
 * Format an optional modified date for display.
 */
export function formatDate(value: string | null): string {
  if (!value) {
    return "";
  }
  return new Date(value).toLocaleDateString();
}

function visitWikiTree(
  node: WikiHomeTreeNode | null,
  visit: (node: WikiHomeTreeNode) => void,
): void {
  if (!node) {
    return;
  }
  visit(node);
  for (const child of node.children ?? []) {
    visitWikiTree(child, visit);
  }
}

function findWikiContentRoot(tree: WikiHomeTreeNode | null): WikiHomeTreeNode | null {
  if (!tree) {
    return null;
  }
  if (tree.path === "wiki" && tree.kind === "dir") {
    const nestedWiki = (tree.children ?? []).find((child) => child.path === "wiki" && child.kind === "dir");
    return nestedWiki ?? tree;
  }
  return tree;
}
