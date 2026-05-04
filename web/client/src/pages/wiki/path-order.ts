/**
 * Local ordering for Peiweipedia sidebar path trees.
 *
 * The compiled wiki tree remains the source of truth for folders and files.
 * This module only stores the user's sibling order preference in localStorage,
 * then applies it when rendering the left sidebar.
 */

interface WikiSidebarTreeNode {
  name: string;
  path: string;
  kind: "file" | "dir";
  children?: WikiSidebarTreeNode[];
}

const STORAGE_KEY = "llmWiki.sidebarPathOrder.v1";
const DRAG_TYPE = "application/x-llm-wiki-path";

export function sortWikiSidebarTree<T extends WikiSidebarTreeNode>(tree: T | null): T | null {
  if (!tree) return null;
  return sortNode(tree, readOrderStore());
}

export function bindWikiPathOrder(root: HTMLElement): void {
  root.addEventListener("dragstart", handleDragStart);
  root.addEventListener("dragover", handleDragOver);
  root.addEventListener("drop", handleDrop);
  root.addEventListener("dragend", clearDragState);
}

function sortNode<T extends WikiSidebarTreeNode>(node: T, store: Record<string, string[]>): T {
  const children = node.children ? sortChildren(node.path, node.children, store).map((child) => sortNode(child, store)) : undefined;
  return children ? ({ ...node, children } as T) : node;
}

function sortChildren<T extends WikiSidebarTreeNode>(
  parentPath: string,
  children: readonly T[],
  store: Record<string, string[]>,
): T[] {
  const order = store[parentPath] ?? [];
  const indexByPath = new Map(order.map((path, index) => [path, index]));
  return [...children].sort((left, right) => {
    const leftIndex = indexByPath.get(left.path) ?? Number.POSITIVE_INFINITY;
    const rightIndex = indexByPath.get(right.path) ?? Number.POSITIVE_INFINITY;
    return leftIndex === rightIndex ? 0 : leftIndex - rightIndex;
  });
}

function handleDragStart(event: DragEvent): void {
  const item = findPathItem(event.target);
  if (!item || !event.dataTransfer) return;
  item.classList.add("is-dragging");
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData(DRAG_TYPE, item.dataset.wikiPathItem ?? "");
}

function handleDragOver(event: DragEvent): void {
  const item = findPathItem(event.target);
  const source = findDraggedItem();
  if (!item || !source || !event.dataTransfer || item === source || !isSameParent(item, source)) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "move";
  item.classList.add("is-drop-target");
}

function handleDrop(event: DragEvent): void {
  const target = findPathItem(event.target);
  const source = findDraggedItem();
  if (!target || !source || target === source || !isSameParent(target, source)) return;
  event.preventDefault();
  moveSourceItem(source, target, event.clientY);
  saveRenderedSiblingOrder(source.parentElement);
  clearDragState();
}

function moveSourceItem(source: HTMLElement, target: HTMLElement, clientY: number): void {
  const rect = target.getBoundingClientRect();
  const shouldPlaceAfter = clientY > rect.top + rect.height / 2;
  target.parentElement?.insertBefore(source, shouldPlaceAfter ? target.nextElementSibling : target);
}

function saveRenderedSiblingOrder(list: Element | null): void {
  const firstItem = list?.querySelector<HTMLElement>(":scope > [data-wiki-path-item]");
  const parentPath = firstItem?.dataset.wikiParentPath;
  if (!list || !parentPath) return;
  const paths = Array.from(list.querySelectorAll<HTMLElement>(":scope > [data-wiki-path-item]"))
    .map((item) => item.dataset.wikiPathItem)
    .filter((path): path is string => Boolean(path));
  const store = readOrderStore();
  store[parentPath] = paths;
  writeOrderStore(store);
}

function findPathItem(target: EventTarget | null): HTMLElement | null {
  return target instanceof HTMLElement ? target.closest<HTMLElement>("[data-wiki-path-item]") : null;
}

function findDraggedItem(): HTMLElement | null {
  return document.querySelector<HTMLElement>("[data-wiki-path-item].is-dragging");
}

function isSameParent(left: HTMLElement, right: HTMLElement): boolean {
  return left.dataset.wikiParentPath === right.dataset.wikiParentPath;
}

function clearDragState(): void {
  document.querySelectorAll<HTMLElement>("[data-wiki-path-item].is-dragging, [data-wiki-path-item].is-drop-target")
    .forEach((item) => item.classList.remove("is-dragging", "is-drop-target"));
}

function readOrderStore(): Record<string, string[]> {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}") as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed)
        .filter((entry): entry is [string, string[]] => Array.isArray(entry[1]))
        .map(([key, value]) => [key, value.filter((item): item is string => typeof item === "string")]),
    );
  } catch {
    return {};
  }
}

function writeOrderStore(store: Record<string, string[]>): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}
