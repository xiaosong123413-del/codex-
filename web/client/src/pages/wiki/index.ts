/**
 * Peiweipedia-style wiki reader for the main web UI.
 */
import { renderAboutMeProfilePage } from "./about-me-profile.js";
import { renderWikiHomeCoverPage } from "./home-cover.js";
import { isWikiSourceLikePath } from "./home-tree.js";
import { renderIdentityInfoProfilePage } from "./identity-info-profile.js";
import { enhanceCaseLibraryPage } from "./case-library.js";
import { enhancePersonalTimelinePage } from "./personal-timeline.js";
import { enhanceWikiRelationGraphs } from "./relation-graph.js";
import { clearWikiPageGraph, disposeWikiPageGraph, mountWikiPageGraph } from "./page-graph.js";
import { createWikiLinkPreviewController } from "./link-preview.js";
import { createWikiPageSideImageController } from "./side-image.js";
import { bindWikiPathCopy } from "./path-copy.js";
import { bindWikiPathOrder, sortWikiSidebarTree } from "./path-order.js";
import {
  createWikiCommentSurface,
  type WikiCommentSurfaceController,
} from "../../components/wiki-comments.js";
import {
  createWikiSelectionToolbar,
  type WikiSelectionToolbarController,
} from "../../components/wiki-selection-toolbar.js";
import {
  applyPanelWidth,
  clampPanelWidth,
  readPanelWidth,
  writePanelWidth,
  type PanelWidthBounds,
} from "../../shell/panel-layout.js";
import { attachResizeHandle } from "../../shell/resize-handle.js";
import { bindPageSearchShortcut } from "../../search-shortcut.js";

interface WikiPageResponse {
  path: string;
  title: string | null;
  html: string;
  raw?: string;
  frontmatter: Record<string, unknown> | null;
  aliases?: string[];
  sizeBytes?: number;
  modifiedAt?: string;
  sourceEditable?: boolean;
}

interface WikiTreeNode {
  name: string;
  path: string;
  kind: "file" | "dir";
  modifiedAt?: string;
  children?: WikiTreeNode[];
}

interface WikiDirectory {
  name: string;
  pages: WikiPageLink[];
}

interface WikiPageLink {
  path: string;
  title: string;
  modifiedAt?: string;
}

interface WikiPageCard extends WikiPageLink {
  modifiedAt: string;
}

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

interface WikiSearchResult {
  path: string;
  title: string;
  excerpt: string;
  tags: string[];
  modifiedAt: string | null;
  images?: WikiSearchImage[];
  retrievalSources?: string[];
}

interface WikiSearchImage {
  alt: string;
  url: string;
}

interface WikiSearchResponse {
  local: {
    results: WikiSearchResult[];
  };
}

interface WikiPageData {
  article: WikiPageResponse | null;
  navigation: WikiPageLink[];
  categories: WikiDirectory[];
  recentlyUpdated: WikiPageCard[];
}

interface WikiTocEntry {
  id: string;
  label: string;
  level: number;
}

type DisposableNode = HTMLElement & {
  __dispose?: () => void;
};

const DEFAULT_INDEX_PATH = "wiki/index.md";
const ABOUT_ME_PATH = "wiki/个人信息档案/about-me.md";
const IDENTITY_INFO_PATH = "wiki/个人信息档案/个人身份信息档案.md";
const wikiPageTimers = new WeakMap<HTMLElement, Set<number>>();
const WIKI_TOC_BOUNDS: PanelWidthBounds = {
  defaultWidth: 320,
  minWidth: 240,
  maxWidth: 480,
};

// fallow-ignore-next-line complexity
export function renderWikiPage(initialPath = DEFAULT_INDEX_PATH, initialAnchor = ""): HTMLElement {
  if (initialPath === DEFAULT_INDEX_PATH) {
    return renderWikiHomeCoverPage(initialPath);
  }
  if (initialPath === ABOUT_ME_PATH) {
    return renderAboutMeProfilePage(initialPath);
  }
  if (initialPath === IDENTITY_INFO_PATH) {
    return renderIdentityInfoProfilePage(initialPath);
  }
  const root = document.createElement("section") as DisposableNode;
  wikiPageTimers.set(root, new Set());
  root.dataset.wikiCurrentPath = initialPath;
  root.dataset.wikiCurrentAnchor = initialAnchor;
  root.className = "wiki-page";
  root.innerHTML = `
    <aside class="wiki-page__sidebar">
      <a class="wiki-page__brand" data-wiki-brand-link href="${wikiHref(ABOUT_ME_PATH)}">
        <div class="wiki-page__mark">F</div>
        <strong>Peiweipedia</strong>
        <span>The Personal Encyclopedia</span>
      </a>
      <section class="wiki-page__sidebar-section">
        <h2>Navigation</h2>
        <div class="wiki-page__sidebar-toolbar">
          <button type="button" data-wiki-delete-select>选择</button>
          <button type="button" data-wiki-delete-selected hidden disabled>删除</button>
          <button type="button" data-wiki-delete-cancel hidden>取消</button>
        </div>
        <p class="wiki-page__sidebar-status" data-wiki-delete-status hidden></p>
        <nav class="wiki-page__sidebar-links" data-wiki-navigation>
          <a href="${wikiHref(DEFAULT_INDEX_PATH)}">Main page</a>
          <a href="${wikiHref(DEFAULT_INDEX_PATH)}">Recent changes</a>
          <a href="${wikiHref(DEFAULT_INDEX_PATH)}">Random article</a>
        </nav>
      </section>
      <section class="wiki-page__sidebar-section" hidden>
        <h2>Categories</h2>
        <nav class="wiki-page__sidebar-links" data-wiki-sidebar-categories>
          <span class="wiki-page__placeholder">Loading categories...</span>
        </nav>
      </section>
    </aside>
    <main class="wiki-page__main">
      <div class="wiki-page__chrome" data-wiki-chrome>
        <header class="wiki-page__header">
          <div class="wiki-page__header-copy">
            <div class="wiki-page__eyebrow">PEIWEIPEDIA</div>
            <h1 data-wiki-title>Wiki</h1>
            <p class="wiki-page__subtitle">The Personal Encyclopedia</p>
          </div>
          <form class="wiki-page__search" data-wiki-search>
            <input data-wiki-search-input type="search" placeholder="Search Peiweipedia" autocomplete="off" />
            <button type="submit">Search</button>
          </form>
          <a class="wiki-page__open" data-wiki-open-current href="${wikiHref(initialPath)}">\u6253\u5f00 wiki</a>
        </header>
        <nav class="wiki-page__tabs" aria-label="Page tools">
          <div class="wiki-page__tab-group wiki-page__tab-group--mode" data-wiki-page-mode-group>
            <a class="is-active" aria-current="page">Article</a>
            <button type="button" class="wiki-page__tab-action" data-wiki-action="talk">Talk</button>
          </div>
          <div class="wiki-page__tab-group wiki-page__tab-group--tools" data-wiki-reading-tools-group>
            <a class="is-active" aria-current="page">Read</a>
            <button type="button" class="wiki-page__tab-action" data-wiki-toc-toggle aria-pressed="false">目录</button>
            <button type="button" class="wiki-page__tab-action" data-wiki-comment-action>Comment</button>
          </div>
        </nav>
      </div>
      <div class="wiki-page__body" data-wiki-body>
        <section class="wiki-page__lead" hidden>
          <div>
            <div class="wiki-page__article-path" data-wiki-path>wiki/index.md</div>
            <p class="wiki-page__article-meta" data-wiki-meta>Loading article...</p>
          </div>
        </section>
        <div class="wiki-page__selection-toolbar" data-wiki-selection-toolbar hidden>
          <button type="button" class="wiki-page__tab-action" data-wiki-selection-comment>评论</button>
          <button type="button" class="wiki-page__tab-action" data-wiki-selection-copy>复制</button>
          <button type="button" class="wiki-page__tab-action" data-wiki-selection-cancel>取消</button>
        </div>
        <div class="wiki-page__article-layout">
          <section class="wiki-page__graph" data-wiki-page-graph hidden></section>
          <article class="wiki-page__article markdown-rendered" data-wiki-article>
            <div class="wiki-page__empty-state">
              <h2>Loading Peiweipedia...</h2>
              <p>The personal encyclopedia is preparing the default article.</p>
            </div>
          </article>
          <aside class="wiki-comments-panel wiki-page__comments">
            <div class="wiki-comments-panel__header">
              <div>
                <div class="wiki-page__eyebrow">COMMENTS</div>
                <h2 class="wiki-comments-panel__title">评论</h2>
              </div>
              <div class="wiki-comments-panel__actions">
                <button type="button" class="wiki-page__tab-action" data-wiki-comments-close>关闭</button>
              </div>
            </div>
            <p class="wiki-comments-panel__hint">这里保存当前 wiki 页评论；会和对话页预览中的同一路径评论互通。</p>
            <p class="wiki-comments-panel__status" data-wiki-comments-status>选中文本后点击浮动“评论”。</p>
            <div data-wiki-comments-list></div>
          </aside>
        </div>
        <aside class="wiki-page__toc" data-wiki-toc-panel hidden>
          <div class="wiki-page__toc-resize panel-resize-handle" data-wiki-toc-resize></div>
          <div class="wiki-page__toc-card">
            <div class="wiki-page__toc-header">
              <div>
                <div class="wiki-page__eyebrow">CONTENTS</div>
                <h2>目录</h2>
              </div>
              <button type="button" class="wiki-page__toc-close" aria-label="关闭目录" data-wiki-toc-close>&times;</button>
            </div>
            <nav class="wiki-page__toc-list" data-wiki-toc-list>
              <div class="wiki-page__placeholder">当前页面没有目录</div>
            </nav>
          </div>
        </aside>
        <section class="wiki-page__modules">
          <section class="wiki-page__module wiki-page__module--categories">
            <h2>Categories</h2>
            <div class="wiki-page__module-body" data-wiki-categories>
              <div class="wiki-page__placeholder">Loading categories...</div>
            </div>
          </section>
          <section class="wiki-page__module wiki-page__module--recent">
            <h2>Recently updated</h2>
            <div class="wiki-page__module-body" data-wiki-recent>
              <div class="wiki-page__placeholder">Loading recent pages...</div>
            </div>
          </section>
          <section class="wiki-page__module wiki-page__module--about">
            <h2>About</h2>
            <div class="wiki-page__module-body" data-wiki-about>
        <p>Peiweipedia is the local Wikipedia-style reader for the compiled wiki.</p>
            </div>
          </section>
        </section>
      </div>
    </main>
  `;

  const refs = getRefs(root);
  const controller = new AbortController();
  const comments = createCommentsSurface(refs);
  const linkPreview = createWikiLinkPreviewController(root);
  const disposeToc = bindWikiToc(root, refs);
  const disposeSearchShortcut = bindPageSearchShortcut(root, () => refs.article);
  let currentTree: WikiTreeNode | null = null;
  let deleteSelectMode = false;
  const selectedDeletePaths = new Set<string>();
  const sideImage = createWikiPageSideImageController({
    refs: { article: refs.article },
    onUploaded: async () => {
      await refreshCurrentWikiPage(root, refs, controller.signal, comments, selectionToolbar, sideImage);
    },
  });
  const selectionToolbar = createWikiSelectionToolbar({
    article: refs.article,
    toolbar: refs.selectionToolbar,
    commentButton: refs.selectionComment,
    copyButton: refs.selectionCopy,
    cancelButton: refs.selectionCancel,
    comments,
    beforeCreateComment: () => {
      closeWikiToc(refs);
    },
  });

  root.__dispose = () => {
    disposeSearchShortcut();
    controller.abort();
    disposeToc();
    linkPreview.dispose();
    selectionToolbar.dispose();
    disposeWikiPageGraph(root);
    clearWikiPageTimers(root);
  };
  bindWikiPathCopy(root);
  bindWikiPathOrder(root);
  const rerenderTree = (): void => {
    renderWikiTreeData(refs, currentTree, selectedDeletePaths, deleteSelectMode);
    syncDeleteToolbar(refs, selectedDeletePaths, deleteSelectMode);
  };
  const reloadTree = async (): Promise<void> => {
    currentTree = await fetchWikiTree(controller.signal);
    if (!controller.signal.aborted) {
      rerenderTree();
    }
  };
  const deletePaths = async (paths: readonly string[]): Promise<void> => {
    await deleteWikiPages(root, refs, paths, controller.signal);
    selectedDeletePaths.clear();
    deleteSelectMode = false;
    await reloadTree();
  };

  // fallow-ignore-next-line complexity
  root.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const deleteButton = target.closest<HTMLButtonElement>("[data-wiki-delete-path]");
    if (deleteButton) {
      event.preventDefault();
      const path = deleteButton.dataset.wikiDeletePath;
      if (path && confirm(`删除页面 ${path}？`)) {
        void deletePaths([path]);
      }
      return;
    }
    const deleteCheckbox = target.closest<HTMLInputElement>("[data-wiki-delete-check]");
    if (deleteCheckbox) {
      const path = deleteCheckbox.dataset.wikiDeleteCheck;
      if (path) {
        if (deleteCheckbox.checked) {
          selectedDeletePaths.add(path);
        } else {
          selectedDeletePaths.delete(path);
        }
        syncDeleteToolbar(refs, selectedDeletePaths, deleteSelectMode);
      }
      return;
    }
    if (target.closest("[data-wiki-delete-select]")) {
      deleteSelectMode = true;
      rerenderTree();
      return;
    }
    if (target.closest("[data-wiki-delete-cancel]")) {
      deleteSelectMode = false;
      selectedDeletePaths.clear();
      rerenderTree();
      return;
    }
    if (target.closest("[data-wiki-delete-selected]")) {
      const paths = Array.from(selectedDeletePaths);
      if (paths.length > 0 && confirm(`删除选中的 ${paths.length} 个页面？`)) {
        void deletePaths(paths);
      }
      return;
    }
    const renderedWikilink = target.closest<HTMLAnchorElement>("a.wikilink");
    if (renderedWikilink) {
      const url = new URL(renderedWikilink.href, window.location.origin);
      const page = url.searchParams.get("page");
      if (page) {
        event.preventDefault();
        const nextHash = wikiHref(page, url.hash ? decodeURIComponent(url.hash.slice(1)) : undefined);
        if (window.location.hash !== nextHash) {
          window.location.hash = nextHash;
        }
        return;
      }
    }
    const wikiLink = target.closest<HTMLAnchorElement>("a[href^='#/wiki/']");
    if (wikiLink) {
      event.preventDefault();
      const nextHash = wikiLink.getAttribute("href");
      if (!nextHash) return;
      const parsed = parseWikiHref(nextHash);
      if (parsed?.anchor && parsed.path === root.dataset.wikiCurrentPath) {
        const anchorTarget = refs.article.querySelector<HTMLElement>(`#${cssEscape(parsed.anchor)}`);
        if (anchorTarget) {
          highlightWikiAnchorTarget(root, anchorTarget);
          scrollWikiTargetIntoView(anchorTarget);
          return;
        }
      }
      if (window.location.hash !== nextHash) {
        window.location.hash = nextHash;
      }
      return;
    }
    const action = target.closest<HTMLElement>("[data-wiki-action]")?.dataset.wikiAction;
    if (!action) {
      return;
    }
    const currentPath = root.dataset.wikiCurrentPath ?? DEFAULT_INDEX_PATH;
    if (action === "talk") {
      queueWikiPageForChat(currentPath);
      window.location.hash = "#/chat";
      return;
    }
  });
  refs.commentAction.addEventListener("click", () => {
    if (refs.commentPanel.hidden) {
      closeWikiToc(refs);
    }
    comments.toggle();
  });
  refs.searchForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const query = refs.searchInput.value.trim();
    if (!query) {
        void loadWikiPage(root, refs, controller.signal, comments, selectionToolbar, sideImage);
        return;
      }
      void runWikiSearch(root, refs, query, controller.signal, comments, selectionToolbar, sideImage);
  });

  void loadWikiPage(root, refs, controller.signal, comments, selectionToolbar, sideImage, initialAnchor, (tree) => {
    currentTree = tree;
    rerenderTree();
  });
  return root;
}

async function runWikiSearch(
  root: DisposableNode,
  refs: ReturnType<typeof getRefs>,
  query: string,
  signal: AbortSignal,
  comments: WikiCommentSurfaceController,
  selectionToolbar: WikiSelectionToolbarController,
  sideImage: ReturnType<typeof createWikiPageSideImageController>,
): Promise<void> {
  try {
    selectionToolbar.reset();
    refs.title.textContent = `搜索：${query}`;
    refs.path.textContent = "/api/search";
    refs.meta.textContent = "Searching local wiki, raw, sources_full, and vector index...";
    refs.article.innerHTML = `<div class="wiki-page__placeholder">Searching...</div>`;
    clearWikiPageGraph(root, refs.pageGraph);

    const response = await fetch(
      `/api/search?scope=local&mode=hybrid&q=${encodeURIComponent(query)}`,
      { signal },
    );
    const payload = (await response.json()) as ApiResponse<WikiSearchResponse>;
    if (!response.ok || !payload.success || !payload.data) {
      throw new Error(payload.error ?? "Search failed");
    }
    if (signal.aborted) return;
      renderSearchResults(refs, query, payload.data.local.results);
      renderWikiTableOfContents(root, refs, []);
      selectionToolbar.reset();
      sideImage.setDocument(null);
      clearWikiPageGraph(root, refs.pageGraph);
      comments.clear("搜索结果不支持评论。");
  } catch {
    if (signal.aborted) return;
    refs.meta.textContent = "Search failed";
    refs.article.innerHTML = `
      <div class="wiki-page__empty-state">
        <h2>Search failed.</h2>
        <p>The unified local search endpoint did not return results.</p>
      </div>
    `;
    renderWikiTableOfContents(root, refs, []);
    selectionToolbar.reset();
    sideImage.setDocument(null);
    clearWikiPageGraph(root, refs.pageGraph);
    comments.clear("搜索结果不支持评论。");
  }
}

function renderSearchResults(refs: ReturnType<typeof getRefs>, query: string, results: WikiSearchResult[]): void {
  const images = collectSearchImages(results, query);
  refs.title.textContent = `搜索：${query}`;
  refs.path.textContent = "/api/search";
  refs.meta.textContent = `${results.length} local result${results.length === 1 ? "" : "s"} · ${images.length} image${images.length === 1 ? "" : "s"}`;
  refs.article.innerHTML = results.length === 0
    ? `
      <div class="wiki-page__empty-state">
        <h2>No results.</h2>
        <p>No local wiki, raw, sources_full, or vector result matched <code>${escapeHtml(query)}</code>.</p>
      </div>
    `
    : `
      ${images.length ? renderSearchImages(images) : ""}
      <section class="wiki-page__search-results">
        ${results.map((result) => `
          <article class="wiki-page__search-result">
            <h2><a href="${wikiHref(result.path)}" title="${escapeHtml(result.path)}">${escapeHtml(result.title)}</a></h2>
            <p>${escapeHtml(result.excerpt || result.path)}</p>
            <div class="wiki-page__search-meta">
              <code>${escapeHtml(result.path)}</code>
              ${renderRetrievalSourceBadges(result.retrievalSources)}
              ${result.modifiedAt ? `<span>${escapeHtml(formatDate(result.modifiedAt))}</span>` : ""}
              ${result.tags.slice(0, 4).map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}
            </div>
          </article>
        `).join("")}
      </section>
    `;
}

function renderRetrievalSourceBadges(sources: string[] | undefined): string {
  return (sources ?? []).map((source) =>
    `<span class="wiki-page__search-source">${escapeHtml(formatRetrievalSource(source))}</span>`
  ).join("");
}

function formatRetrievalSource(source: string): string {
  if (source === "token") return "token";
  if (source === "vector") return "vector";
  if (source === "graph") return "graph";
  return source;
}

function collectSearchImages(results: WikiSearchResult[], query: string): Array<WikiSearchImage & { pagePath: string; pageTitle: string; direct: boolean }> {
  const seen = new Set<string>();
  const normalizedQuery = query.trim().toLowerCase();
  return results.flatMap((result) => (result.images ?? []).map((image) => ({
    ...image,
    pagePath: result.path,
    pageTitle: result.title,
    direct: normalizedQuery.length > 0 && image.alt.toLowerCase().includes(normalizedQuery),
  }))).filter((image) => {
    const key = `${image.pagePath}\n${image.url}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => Number(b.direct) - Number(a.direct)).slice(0, 12);
}

function renderSearchImages(images: Array<WikiSearchImage & { pagePath: string; pageTitle: string; direct: boolean }>): string {
  return `
    <section class="wiki-page__search-images" aria-label="Search result images">
      ${images.map((image) => `
        <a class="wiki-page__search-image" href="${wikiHref(image.pagePath)}" title="${escapeHtml(image.pagePath)}">
          <img src="${escapeHtml(toMediaUrl(image.url))}" alt="${escapeHtml(image.alt || image.pageTitle)}" loading="lazy" />
          <span>${escapeHtml(image.alt || image.pageTitle)}</span>
          <small>${escapeHtml(image.direct ? "caption match" : image.pageTitle)}</small>
        </a>
      `).join("")}
    </section>
  `;
}

// fallow-ignore-next-line complexity
async function loadWikiPage(
  root: DisposableNode,
  refs: ReturnType<typeof getRefs>,
  signal: AbortSignal,
  comments: WikiCommentSurfaceController,
  selectionToolbar: WikiSelectionToolbarController,
  sideImage: ReturnType<typeof createWikiPageSideImageController>,
  initialAnchor = "",
  onTreeLoaded?: (tree: WikiTreeNode | null) => void,
): Promise<void> {
  try {
    const currentPath = root.dataset.wikiCurrentPath ?? DEFAULT_INDEX_PATH;
    const treeRequest = fetchWikiTree(signal);
    const page = await fetchPage(currentPath, signal);

    if (signal.aborted) return;
    if (refs.searchInput.value.trim()) return;

    selectionToolbar.reset();
    if (page) {
      await applyLoadedWikiArticle(root, refs, page, signal, comments, selectionToolbar, sideImage, initialAnchor);
    } else {
      renderEmptyState(refs);
      renderWikiTableOfContents(root, refs, []);
      sideImage.setDocument(null);
      clearWikiPageGraph(root, refs.pageGraph);
      comments.clear("当前页面还没有可评论正文。");
    }

    const tree = await treeRequest;
    if (signal.aborted) return;
    if (refs.searchInput.value.trim()) return;
    onTreeLoaded?.(tree);
  } catch {
    if (signal.aborted) return;
    if (refs.searchInput.value.trim()) return;
    renderEmptyState(refs);
    selectionToolbar.reset();
    renderWikiTableOfContents(root, refs, []);
    sideImage.setDocument(null);
    clearWikiPageGraph(root, refs.pageGraph);
    comments.clear("当前页面还没有可评论正文。");
  }
}

function scrollToWikiAnchor(root: DisposableNode, article: HTMLElement, anchor: string): void {
  if (!anchor) {
    return;
  }
  let attempts = 0;
  const maxAttempts = 24;

  const tryScroll = (): void => {
    const target = article.querySelector<HTMLElement>(`#${cssEscape(anchor)}`);
    if (!target) {
      if (attempts < maxAttempts) {
        attempts += 1;
        scheduleWikiPageTimer(root, tryScroll, 32);
      }
      return;
    }

    highlightWikiAnchorTarget(root, target);
    scrollWikiTargetIntoView(target);

    if (attempts < 2) {
      attempts += 1;
      scheduleWikiPageTimer(root, tryScroll, 48);
    }
  };

  scheduleWikiPageTimer(root, tryScroll, 0);
}

function scrollWikiTargetIntoView(target: HTMLElement): void {
  const scrollContainer = findScrollContainer(target);
  if (!scrollContainer) {
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }

  const targetRect = target.getBoundingClientRect();
  const containerRect = scrollContainer.getBoundingClientRect();
  const top = targetRect.top - containerRect.top + scrollContainer.scrollTop - 24;
  scrollContainer.scrollTo({
    top: Math.max(top, 0),
    behavior: "smooth",
  });
}

function findScrollContainer(node: HTMLElement): HTMLElement | null {
  let current = node.parentElement;
  while (current) {
    const styles = window.getComputedStyle(current);
    const overflowY = styles.overflowY;
    const overflow = styles.overflow;
    const scrollable = overflowY === "auto"
      || overflowY === "scroll"
      || overflow === "auto"
      || overflow === "scroll";
    if (scrollable && current.scrollHeight > current.clientHeight) {
      return current;
    }
    current = current.parentElement;
  }
  return null;
}

function highlightWikiAnchorTarget(root: DisposableNode, target: HTMLElement): void {
  target.classList.add("wiki-page__anchor-target");
  scheduleWikiPageTimer(root, () => {
    target.classList.remove("wiki-page__anchor-target");
  }, 1600);
}

function scheduleWikiPageTimer(root: HTMLElement, callback: () => void, delay: number): void {
  const timerSet = wikiPageTimers.get(root);
  const timeoutId = window.setTimeout(() => {
    timerSet?.delete(timeoutId);
    callback();
  }, delay);
  timerSet?.add(timeoutId);
}

function clearWikiPageTimers(root: HTMLElement): void {
  const timerSet = wikiPageTimers.get(root);
  if (!timerSet) {
    return;
  }
  for (const timeoutId of timerSet) {
    window.clearTimeout(timeoutId);
  }
  timerSet.clear();
  wikiPageTimers.delete(root);
}

async function fetchPage(path: string, signal: AbortSignal): Promise<WikiPageResponse | null> {
  const response = await fetch(`/api/page?path=${encodeURIComponent(path)}&raw=0`, { signal });
  if (!response.ok) {
    return null;
  }
  return (await response.json()) as WikiPageResponse;
}

async function fetchWikiTree(signal: AbortSignal): Promise<WikiTreeNode | null> {
  try {
    const response = await fetch("/api/tree?layer=wiki", { signal });
    return response.ok ? ((await response.json()) as WikiTreeNode) : null;
  } catch {
    if (signal.aborted) {
      return null;
    }
    return null;
  }
}

async function deleteWikiPages(
  root: DisposableNode,
  refs: ReturnType<typeof getRefs>,
  paths: readonly string[],
  signal: AbortSignal,
): Promise<void> {
  refs.deleteStatus.hidden = false;
  refs.deleteStatus.textContent = "Deleting...";
  const response = await fetch("/api/page", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paths }),
    signal,
  });
  const payload = (await response.json()) as ApiResponse<{ paths: string[] }>;
  if (!response.ok || !payload.success) {
    refs.deleteStatus.textContent = payload.error ?? "Delete failed";
    return;
  }
  refs.deleteStatus.textContent = `Deleted ${payload.data?.paths.length ?? paths.length} page(s)`;
  if (paths.includes(root.dataset.wikiCurrentPath ?? "")) {
    window.location.hash = wikiHref(DEFAULT_INDEX_PATH);
  }
}

function syncDeleteToolbar(
  refs: ReturnType<typeof getRefs>,
  selectedDeletePaths: Set<string>,
  deleteSelectMode: boolean,
): void {
  refs.deleteSelect.hidden = deleteSelectMode;
  refs.deleteSelected.hidden = !deleteSelectMode;
  refs.deleteCancel.hidden = !deleteSelectMode;
  refs.deleteSelected.disabled = selectedDeletePaths.size === 0;
  if (deleteSelectMode) {
    refs.deleteStatus.hidden = selectedDeletePaths.size === 0;
    refs.deleteStatus.textContent = selectedDeletePaths.size === 0 ? "" : `Selected ${selectedDeletePaths.size}`;
  }
}

function buildRecentPages(paths: WikiPageLink[]): WikiPageCard[] {
  return paths
    .filter((item): item is WikiPageCard => Boolean(item.modifiedAt) && item.path !== DEFAULT_INDEX_PATH)
    .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))
    .slice(0, 6);
}

function renderPageData(refs: ReturnType<typeof getRefs>, data: WikiPageData): void {
  const article = data.article;
  if (article) {
    renderArticleData(refs, article);
  } else {
    renderEmptyState(refs);
  }

  refs.navigation.innerHTML = renderLinks(data.navigation);
  refs.sidebarCategories.innerHTML = renderDirectoryList(data.categories, "No categories yet");
  refs.categories.innerHTML = renderDirectoryList(data.categories, "No categories indexed yet");
  refs.recent.innerHTML = renderRecentList(data.recentlyUpdated);
  refs.about.innerHTML = `
    <p>Peiweipedia is the local Wikipedia-style reader for the compiled wiki.</p>
    <p>It opens <code>wiki/index.md</code> by default and keeps the reading surface separate from the chat shell.</p>
  `;
}

function renderArticleData(refs: ReturnType<typeof getRefs>, article: WikiPageResponse): void {
  updatePageChrome(refs, article);
  refs.article.innerHTML = article.html || `
    <div class="wiki-page__empty-state">
      <h2>${escapeHtml(article.title ?? "Wiki")}</h2>
      <p>This page exists, but it does not contain rendered article content yet.</p>
    </div>
    `;
  enhanceWikiRelationGraphs(refs.article);
  enhancePersonalTimelinePage(refs.article, article.path);
  enhanceCaseLibraryPage(refs.article, article.path);
}

async function applyLoadedWikiArticle(
  root: DisposableNode,
  refs: ReturnType<typeof getRefs>,
  page: WikiPageResponse,
  signal: AbortSignal,
  comments: WikiCommentSurfaceController,
  selectionToolbar: WikiSelectionToolbarController,
  sideImage: ReturnType<typeof createWikiPageSideImageController>,
  initialAnchor = "",
): Promise<void> {
  renderArticleData(refs, page);
  mountWikiPageGraph(root, refs.pageGraph, page.path, signal);
  sideImage.setDocument(page);
  renderWikiTableOfContents(root, refs);
  scrollToWikiAnchor(root, refs.article, initialAnchor);
  await comments.setDocument(page.path, page.html || "", {
    sourceEditable: page.sourceEditable,
    loadOnSet: false,
    contentAlreadyRendered: Boolean(page.html),
    refreshPage: (confirmedPage) => {
      root.dataset.wikiCurrentPath = confirmedPage.path;
      root.dataset.wikiCurrentAnchor = "";
      updatePageChrome(refs, confirmedPage);
      mountWikiPageGraph(root, refs.pageGraph, confirmedPage.path, signal);
      sideImage.setDocument(confirmedPage);
      renderWikiTableOfContents(root, refs);
      selectionToolbar.reset();
    },
  });
}

async function refreshCurrentWikiPage(
  root: DisposableNode,
  refs: ReturnType<typeof getRefs>,
  signal: AbortSignal,
  comments: WikiCommentSurfaceController,
  selectionToolbar: WikiSelectionToolbarController,
  sideImage: ReturnType<typeof createWikiPageSideImageController>,
): Promise<void> {
  const currentPath = root.dataset.wikiCurrentPath ?? DEFAULT_INDEX_PATH;
  const page = await fetchPage(currentPath, signal);
  if (!page || signal.aborted) {
    return;
  }
  await applyLoadedWikiArticle(root, refs, page, signal, comments, selectionToolbar, sideImage);
}

function renderWikiTreeData(
  refs: ReturnType<typeof getRefs>,
  tree: WikiTreeNode | null,
  selectedDeletePaths = new Set<string>(),
  deleteSelectMode = false,
): void {
  const treePages = flattenTree(tree);
  const categories = buildCategories(tree);
    refs.navigation.innerHTML = renderPathTree(sortWikiSidebarTree(tree), selectedDeletePaths, deleteSelectMode);
  refs.sidebarCategories.innerHTML = renderDirectoryList(categories, "No categories yet");
  refs.categories.innerHTML = renderDirectoryList(categories, "No categories indexed yet");
  refs.recent.innerHTML = renderRecentList(buildRecentPages(treePages));
  refs.about.innerHTML = `
    <p>Peiweipedia is the local Wikipedia-style reader for the compiled wiki.</p>
    <p>It opens <code>wiki/index.md</code> by default and keeps the reading surface separate from the chat shell.</p>
  `;
}

function renderEmptyState(refs: ReturnType<typeof getRefs>): void {
  refs.title.textContent = "Wiki";
  refs.path.textContent = DEFAULT_INDEX_PATH;
  refs.meta.textContent = "No compiled article found";
  refs.openCurrent.href = wikiHref(DEFAULT_INDEX_PATH);
  refs.article.innerHTML = `
    <div class="wiki-page__empty-state">
      <h2>This page does not exist yet.</h2>
      <p>Compile the wiki to generate <code>wiki/index.md</code> and restore the reading view.</p>
      <ul>
        <li>Peiweipedia / The Personal Encyclopedia layout stays intact.</li>
        <li>Article and Talk tabs remain available.</li>
        <li>Navigation, Categories, Recently updated, and About sections still render.</li>
      </ul>
    </div>
  `;
  refs.navigation.innerHTML = renderLinks([
    { path: DEFAULT_INDEX_PATH, title: "Main page" },
  ]);
  refs.sidebarCategories.innerHTML = `<div class="wiki-page__placeholder">No categories yet</div>`;
  refs.categories.innerHTML = `<div class="wiki-page__placeholder">No categories indexed yet</div>`;
  refs.recent.innerHTML = `<div class="wiki-page__placeholder">No recent pages yet</div>`;
  refs.about.innerHTML = `
    <p>Peiweipedia is the local Wikipedia-style reader for the compiled wiki.</p>
    <p>When the default article is missing, the page still stays structured instead of collapsing into plain text.</p>
  `;
}

function updatePageChrome(refs: ReturnType<typeof getRefs>, article: Pick<WikiPageResponse, "path" | "title" | "modifiedAt">): void {
  refs.title.textContent = article.title ?? "Wiki";
  refs.path.textContent = article.path;
  refs.meta.textContent = article.modifiedAt ? `Updated ${formatDate(article.modifiedAt)}` : "Ready to read";
  refs.openCurrent.href = wikiHref(article.path);
}

function getRefs(root: HTMLElement) {
  return {
    title: root.querySelector<HTMLElement>("[data-wiki-title]")!,
    path: root.querySelector<HTMLElement>("[data-wiki-path]")!,
    meta: root.querySelector<HTMLElement>("[data-wiki-meta]")!,
    article: root.querySelector<HTMLElement>("[data-wiki-article]")!,
    pageGraph: root.querySelector<HTMLElement>("[data-wiki-page-graph]")!,
    categories: root.querySelector<HTMLElement>("[data-wiki-categories]")!,
    recent: root.querySelector<HTMLElement>("[data-wiki-recent]")!,
    about: root.querySelector<HTMLElement>("[data-wiki-about]")!,
    navigation: root.querySelector<HTMLElement>("[data-wiki-navigation]")!,
    deleteSelect: root.querySelector<HTMLButtonElement>("[data-wiki-delete-select]")!,
    deleteSelected: root.querySelector<HTMLButtonElement>("[data-wiki-delete-selected]")!,
    deleteCancel: root.querySelector<HTMLButtonElement>("[data-wiki-delete-cancel]")!,
    deleteStatus: root.querySelector<HTMLElement>("[data-wiki-delete-status]")!,
    sidebarCategories: root.querySelector<HTMLElement>("[data-wiki-sidebar-categories]")!,
    openCurrent: root.querySelector<HTMLAnchorElement>("[data-wiki-open-current]")!,
    searchForm: root.querySelector<HTMLFormElement>("[data-wiki-search]")!,
    searchInput: root.querySelector<HTMLInputElement>("[data-wiki-search-input]")!,
    commentAction: root.querySelector<HTMLButtonElement>("[data-wiki-comment-action]")!,
    commentClose: root.querySelector<HTMLButtonElement>("[data-wiki-comments-close]")!,
    commentList: root.querySelector<HTMLElement>("[data-wiki-comments-list]")!,
    commentStatus: root.querySelector<HTMLElement>("[data-wiki-comments-status]")!,
    commentPanel: root.querySelector<HTMLElement>(".wiki-page__comments")!,
    selectionToolbar: root.querySelector<HTMLElement>("[data-wiki-selection-toolbar]")!,
    selectionComment: root.querySelector<HTMLButtonElement>("[data-wiki-selection-comment]")!,
    selectionCopy: root.querySelector<HTMLButtonElement>("[data-wiki-selection-copy]")!,
    selectionCancel: root.querySelector<HTMLButtonElement>("[data-wiki-selection-cancel]")!,
    tocToggle: root.querySelector<HTMLButtonElement>("[data-wiki-toc-toggle]")!,
    tocPanel: root.querySelector<HTMLElement>("[data-wiki-toc-panel]")!,
    tocResize: root.querySelector<HTMLElement>("[data-wiki-toc-resize]")!,
    tocList: root.querySelector<HTMLElement>("[data-wiki-toc-list]")!,
    tocClose: root.querySelector<HTMLButtonElement>("[data-wiki-toc-close]")!,
  };
}

function bindWikiToc(root: DisposableNode, refs: ReturnType<typeof getRefs>): () => void {
  let tocWidth = readPanelWidth("wiki.tocWidth", WIKI_TOC_BOUNDS);
  applyPanelWidth(root, "--wiki-page-toc-width", tocWidth);

  const syncState = (): void => {
    const open = !refs.tocPanel.hidden;
    root.classList.toggle("wiki-page--toc-open", open);
    refs.tocToggle.setAttribute("aria-pressed", open ? "true" : "false");
  };

  const closeToc = (): void => {
    refs.tocPanel.hidden = true;
    syncState();
  };

  const onToggleClick = (): void => {
    if (refs.tocToggle.disabled) {
      return;
    }
    if (refs.tocPanel.hidden) {
      closeWikiComments(refs);
    }
    refs.tocPanel.hidden = !refs.tocPanel.hidden;
    syncState();
  };

  refs.tocToggle.addEventListener("click", onToggleClick);
  refs.tocClose.addEventListener("click", closeToc);

  const disposeResize = attachResizeHandle({
    handle: refs.tocResize,
    onMove(event) {
      tocWidth = clampPanelWidth(window.innerWidth - 24 - event.clientX, WIKI_TOC_BOUNDS);
      applyPanelWidth(root, "--wiki-page-toc-width", tocWidth);
    },
    onEnd() {
      tocWidth = writePanelWidth("wiki.tocWidth", tocWidth, WIKI_TOC_BOUNDS);
      applyPanelWidth(root, "--wiki-page-toc-width", tocWidth);
    },
  });

  syncState();
  return () => {
    refs.tocToggle.removeEventListener("click", onToggleClick);
    refs.tocClose.removeEventListener("click", closeToc);
    disposeResize();
  };
}

function closeWikiToc(refs: ReturnType<typeof getRefs>): void {
  if (!refs.tocPanel.hidden) {
    refs.tocClose.click();
  }
}

function closeWikiComments(refs: ReturnType<typeof getRefs>): void {
  if (!refs.commentPanel.hidden) {
    refs.commentClose.click();
  }
}

function renderWikiTableOfContents(
  root: DisposableNode,
  refs: ReturnType<typeof getRefs>,
  entries = collectWikiTocEntries(refs.article),
): void {
  if (entries.length === 0) {
    refs.tocList.innerHTML = `<div class="wiki-page__placeholder">当前页面没有目录</div>`;
    refs.tocToggle.disabled = true;
    refs.tocPanel.hidden = true;
    root.classList.remove("wiki-page--toc-open");
    refs.tocToggle.setAttribute("aria-pressed", "false");
    return;
  }

  refs.tocToggle.disabled = false;
  refs.tocList.innerHTML = entries.map((entry) => `
    <button
      type="button"
      class="wiki-page__toc-link wiki-page__toc-link--level-${entry.level}"
      data-wiki-toc-target="${escapeHtml(entry.id)}"
    >${escapeHtml(entry.label)}</button>
  `).join("");

  refs.tocList.querySelectorAll<HTMLButtonElement>("[data-wiki-toc-target]").forEach((button) => {
    button.addEventListener("click", () => {
      const targetId = button.dataset.wikiTocTarget;
      if (!targetId) {
        return;
      }
      const target = refs.article.querySelector<HTMLElement>(`#${cssEscape(targetId)}`);
      target?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
}

function collectWikiTocEntries(article: HTMLElement): WikiTocEntry[] {
  const headings = Array.from(article.querySelectorAll<HTMLHeadingElement>("h1,h2,h3,h4"));
  return headings.map((heading, index) => {
    const level = Number(heading.tagName.slice(1));
    const id = heading.id || `wiki-heading-${index}`;
    heading.id = id;
    return {
      id,
      label: heading.textContent?.trim() || `Section ${index + 1}`,
      level,
    };
  });
}

function flattenTree(tree: WikiTreeNode | null): WikiPageLink[] {
  if (!tree) return [];
  const nodes: WikiPageLink[] = [];
  const visit = (node: WikiTreeNode): void => {
    if (node.kind === "file") {
      if (isWikiSourceLikePath(node.path)) return;
      nodes.push({
        path: node.path,
        title: pageTitleFromPath(node.name, node.name),
        modifiedAt: node.modifiedAt,
      });
      return;
    }
    for (const child of node.children ?? []) {
      visit(child);
    }
  };
  visit(tree);
  return nodes;
}

function buildCategories(tree: WikiTreeNode | null): WikiDirectory[] {
  const children = tree?.children?.find((child) => child.kind === "dir" && child.name === "wiki")?.children ?? tree?.children ?? [];
  return children
    .filter((child) => child.kind === "dir" && !isWikiSourceLikePath(child.path))
    .slice(0, 4)
    .map((child) => ({
      name: pageTitleFromPath(child.path, child.name),
      pages: (child.children ?? [])
        .filter((grandChild) => grandChild.kind === "file")
        .slice(0, 5)
        .map((grandChild) => ({
          path: grandChild.path,
          title: pageTitleFromPath(grandChild.name, grandChild.name),
        })),
    }));
}

function renderLinks(items: WikiPageLink[]): string {
  if (items.length === 0) {
    return `<div class="wiki-page__placeholder">No navigation items yet</div>`;
  }
  return items
    .map(
      (item) => `<a href="${wikiHref(item.path)}" title="${escapeHtml(item.path)}">${escapeHtml(item.title)}</a>`,
    )
    .join("");
}

function renderPathTree(
  tree: WikiTreeNode | null,
  selectedDeletePaths = new Set<string>(),
  deleteSelectMode = false,
): string {
  const root = findWikiContentRoot(tree);
  if (!root) {
    return `<div class="wiki-page__placeholder">No navigation items yet</div>`;
  }
  return `<ul class="wiki-page__path-tree">${renderPathNodes(root.children ?? [], root.path, selectedDeletePaths, deleteSelectMode)}</ul>`;
}

function renderPathNodes(
  nodes: readonly WikiTreeNode[],
  parentPath: string,
  selectedDeletePaths: Set<string>,
  deleteSelectMode: boolean,
): string {
  return nodes.filter((node) => !isWikiSourceLikePath(node.path)).map((node) => {
    if (node.kind === "dir") {
      return `
        <li data-wiki-path-item="${escapeHtml(node.path)}" data-wiki-parent-path="${escapeHtml(parentPath)}" draggable="true">
          <details open>
            <summary data-wiki-path-node="${escapeHtml(node.path)}" title="${escapeHtml(node.path)}">
              ${escapeHtml(pageTitleFromPath(node.path, node.name))}
            </summary>
            <ul>${renderPathNodes(node.children ?? [], node.path, selectedDeletePaths, deleteSelectMode)}</ul>
          </details>
        </li>
      `;
    }
    const checked = selectedDeletePaths.has(node.path) ? " checked" : "";
    const checkbox = deleteSelectMode
      ? `<input type="checkbox" data-wiki-delete-check="${escapeHtml(node.path)}" aria-label="选择 ${escapeHtml(pageTitleFromPath(node.name, node.name))}"${checked} />`
      : `<span class="wiki-page__path-select-spacer"></span>`;
    return `
      <li class="wiki-page__path-page" data-wiki-path-item="${escapeHtml(node.path)}" data-wiki-parent-path="${escapeHtml(parentPath)}" data-wiki-path-node="${escapeHtml(node.path)}" title="${escapeHtml(node.path)}" draggable="true">
        ${checkbox}
        <a href="${wikiHref(node.path)}" title="${escapeHtml(node.path)}">${escapeHtml(pageTitleFromPath(node.name, node.name))}</a>
        <button type="button" class="wiki-page__path-delete" data-wiki-delete-path="${escapeHtml(node.path)}" aria-label="删除 ${escapeHtml(pageTitleFromPath(node.name, node.name))}">删除</button>
      </li>
    `;
  }).join("");
}

function findWikiContentRoot(tree: WikiTreeNode | null): WikiTreeNode | null {
  if (!tree) return null;
  if (tree.path === "wiki" && tree.kind === "dir") {
    return (tree.children ?? []).find((child) => child.path === "wiki" && child.kind === "dir") ?? tree;
  }
  return tree;
}

function renderDirectoryList(items: WikiDirectory[], emptyLabel: string): string {
  if (items.length === 0) {
    return `<div class="wiki-page__placeholder">${escapeHtml(emptyLabel)}</div>`;
  }
  return items
    .map(
      (item) => `
        <div class="wiki-page__directory">
          <h3>${escapeHtml(item.name)}</h3>
          <ul>
            ${
              item.pages.length === 0
                ? `<li class="wiki-page__placeholder">${escapeHtml(emptyLabel)}</li>`
                : item.pages
                    .map(
                      (page) =>
                        `<li><a href="${wikiHref(page.path)}" title="${escapeHtml(page.path)}">${escapeHtml(page.title)}</a></li>`,
                    )
                    .join("")
            }
          </ul>
        </div>
      `,
    )
    .join("");
}

function renderRecentList(items: WikiPageCard[]): string {
  if (items.length === 0) {
    return `<div class="wiki-page__placeholder">No recent pages yet</div>`;
  }
  return `
    <ul class="wiki-page__recent-list">
      ${items
        .map(
          (item) => `
            <li>
              <a href="${wikiHref(item.path)}" title="${escapeHtml(item.path)}">${escapeHtml(item.title)}</a>
              <span>${escapeHtml(formatDate(item.modifiedAt))}</span>
            </li>
          `,
        )
        .join("")}
    </ul>
  `;
}

function pageTitleFromPath(path: string, fallback: string): string {
  const base = path.split("/").pop() ?? fallback;
  return base.replace(/\.(md|markdown|txt)$/i, "").replace(/[-_]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString();
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

function cssEscape(value: string): string {
  const css = (window as Window & { CSS?: { escape?: (input: string) => string } }).CSS;
  if (typeof css?.escape === "function") {
    return css.escape(value);
  }
  return value.replace(/["\\]/g, "\\$&");
}

function wikiHref(path: string, anchor?: string): string {
  const route = `#/wiki/${encodeURIComponent(path)}`;
  return anchor ? `${route}#${encodeURIComponent(anchor)}` : route;
}

function toMediaUrl(url: string): string {
  const trimmed = url.trim();
  if (/^(https?:\/\/|data:image\/)/i.test(trimmed)) {
    return trimmed;
  }
  return `/api/source-gallery/media?path=${encodeURIComponent(trimmed.replace(/^\/+/, ""))}`;
}

function parseWikiHref(href: string): { path: string; anchor: string } | null {
  if (!href.startsWith("#/wiki/")) return null;
  const rest = href.slice(7);
  const hashIdx = rest.indexOf("#");
  if (hashIdx === -1) {
    return { path: decodeURIComponent(rest), anchor: "" };
  }
  return {
    path: decodeURIComponent(rest.slice(0, hashIdx)),
    anchor: decodeURIComponent(rest.slice(hashIdx + 1)),
  };
}

function createCommentsSurface(refs: ReturnType<typeof getRefs>): WikiCommentSurfaceController {
  return createWikiCommentSurface({
    content: refs.article,
    list: refs.commentList,
    status: refs.commentStatus,
    panel: refs.commentPanel,
    closeButton: refs.commentClose,
    emptyLabel: "当前 wiki 页还没有评论。",
  });
}

function queueWikiPageForChat(path: string): void {
  const storageKey = "llmWiki.pendingChatArticleRefs";
  let current: string[] = [];
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        current = parsed.filter((item): item is string => typeof item === "string");
      }
    }
  } catch {
    current = [];
  }
  if (!current.includes(path)) {
    current.unshift(path);
  }
  window.localStorage.setItem(storageKey, JSON.stringify(current.slice(0, 12)));
}
