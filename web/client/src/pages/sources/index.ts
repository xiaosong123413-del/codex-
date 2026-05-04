import { bindPageSearchShortcut } from "../../search-shortcut.js";
import { eventMatchesShortcut, getClientKeyboardShortcut } from "../../keyboard-shortcuts.js";

type SourceGallerySort = "modified-desc" | "modified-asc" | "created-desc" | "created-asc";
type SourceGalleryViewMode = "sources" | "subscriptions";

interface SourceGalleryItem {
  id: string;
  path: string;
  title: string;
  layer: "raw" | "source";
  bucket: string;
  tags: string[];
  modifiedAt: string;
  createdAt: string;
  excerpt: string;
  previewImageUrl?: string;
  sourceUrl?: string;
  mediaCount: number;
  mediaKinds: Array<"image" | "pdf" | "video" | "audio">;
  ocrTextPath?: string;
  transcriptPath?: string;
}

interface SourceGalleryDetail {
  id: string;
  path: string;
  title: string;
  raw: string;
  html: string;
  previewImageUrl?: string;
  media: Array<{
    kind: "image" | "pdf" | "video" | "audio";
    path: string;
    url?: string;
  }>;
  sourceUrl?: string;
  mediaCount: number;
  mediaKinds: Array<"image" | "pdf" | "video" | "audio">;
  ocrTextPath?: string;
  transcriptPath?: string;
}

interface SourceGalleryFilterOptions {
  buckets: string[];
  tags: string[];
  layers: Array<"raw" | "source">;
}

interface SourceGalleryListResponse {
  items: SourceGalleryItem[];
  filters: SourceGalleryFilterOptions;
}

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

interface SearchApiResult {
  path: string;
}

interface SearchApiResponse {
  local: {
    results: SearchApiResult[];
  };
}

interface SourceGalleryDeleteResult {
  deleted: string[];
  missing: string[];
}

interface ChatThreadMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
}

interface ChatConversation {
  id: string;
  title: string;
  articleRefs: string[];
  messages: ChatThreadMessage[];
}

interface SourceWorkspaceCompileResult {
  inputPath: string;
  started: boolean;
  runId?: string;
}

interface PageState {
  items: SourceGalleryItem[];
  selectedIds: Set<string>;
  selectedPaths: Map<string, string>;
  refreshId: number;
  sort: SourceGallerySort;
  viewMode: SourceGalleryViewMode;
  filters: SourceGalleryFilterOptions;
  selectedBuckets: string[];
  selectedTags: string[];
  selectedLayers: Array<"raw" | "source">;
}

interface SourcesPageRoot extends HTMLElement {
  __dispose?: () => void;
}

interface SourceWorkspaceElement extends HTMLElement {
  __disposeSearchShortcut?: () => void;
}

const SOURCE_GALLERY_ROW_GAP_PX = 16;
const SOURCE_GALLERY_MIN_ROW_HEIGHT_PX = 220;

const TEXT = {
  search: "\u641c\u7d22",
  searchPlaceholder: "\u6807\u9898 / \u6b63\u6587 / URL / \u6807\u7b7e",
  sourcesTab: "\u6e90\u6599",
  subscriptionsTab: "\u8ba2\u9605\u9875",
  source: "\u6765\u6e90",
  tag: "\u6807\u7b7e",
  status: "\u72b6\u6001",
  all: "\u5168\u90e8",
  selectedSummary: (count: number) => `\u5df2\u9009 ${count} \u9879`,
  importChat: "\u5bfc\u5165\u5bf9\u8bdd",
  batchIngest: "\u6279\u91cf ingest",
  toInbox: "\u52a0\u5165 inbox",
  batchDelete: "\u6279\u91cf\u5220\u9664",
  clearSelection: "\u53d6\u6d88\u9009\u62e9",
  movedInbox: "\u5df2\u590d\u5236\u5230 inbox",
  queuedIngest: "\u5df2\u52a0\u5165\u6279\u91cf ingest \u961f\u5217",
  noDeleted: "\u672a\u5220\u9664\u4efb\u4f55\u6e90\u6599",
  itemCount: (count: number) => `${count} \u6761\u6e90\u6599`,
  deletedCount: (count: number) => `\u5df2\u5220\u9664 ${count} \u6761\u6e90\u6599`,
  openOriginal: "\u67e5\u770b\u539f\u6587",
  noMedia: "\u65e0\u5a92\u4f53",
  ocrReady: (path?: string) => `OCR: ${path || "\u672a\u751f\u6210"}`,
  transcriptReady: (path?: string) => `\u8f6c\u5199: ${path || "\u672a\u751f\u6210"}`,
  close: "\u5173\u95ed",
  fullPreview: "\u5168\u5c4f\u9884\u89c8",
  delete: "\u5220\u9664",
  swapPane: "\u5bf9\u8c03\u4f4d\u7f6e",
  guideTitle: "\u4eb2\u81ea\u6307\u5bfc\u5f55\u5165",
  guideSubtitle: "\u56f4\u7ed5\u5f53\u524d\u6e90\u6599\u505a\u6e05\u6d17\u3001\u63d0\u70bc\u548c\u5f55\u5165\u51b3\u7b56\u3002",
  chatPlaceholder: "\u8f93\u5165\u4f60\u7684\u6574\u7406\u8981\u6c42\u3001\u5224\u65ad\u6216\u4e0b\u4e00\u6b65\u52a8\u4f5c\u2026",
  send: "\u53d1\u9001",
  queueCompile: "\u7ed3\u5408\u5bf9\u8bdd\u8fdb\u5165 Compile",
  compileQueued: (inputPath: string) => `\u5df2\u751f\u6210 compile \u8f93\u5165\u5e76\u542f\u52a8 compile\uff1a${inputPath}`,
  noExcerpt: "\u6682\u65e0\u6458\u8981",
  sourcePrefix: "\u6765\u6e90\uff1a",
};

export function renderSourcesPage(): HTMLElement {
  const root = document.createElement("section") as SourcesPageRoot;
  root.className = "source-gallery-shell";
  root.innerHTML = `
    <div class="source-gallery-page">
      <div class="source-gallery-page__chrome">
        <section class="source-gallery-page__filters panel">
          <div class="source-gallery-mode-switch" data-source-gallery-mode-switch role="tablist" aria-label="源料视图">
            <button type="button" data-source-gallery-mode="sources" aria-pressed="true">${TEXT.sourcesTab}</button>
            <button type="button" data-source-gallery-mode="subscriptions" aria-pressed="false">${TEXT.subscriptionsTab}</button>
          </div>
          <div class="source-gallery-filters" data-source-gallery-controls>
            <label class="source-gallery-filter-pill">
              <span>\u6392\u5e8f</span>
              <select data-source-gallery-sort>
                <option value="modified-desc">\u6700\u8fd1\u7f16\u8f91</option>
                <option value="modified-asc">\u6700\u65e9\u7f16\u8f91</option>
                <option value="created-desc">\u6700\u65b0\u521b\u5efa</option>
                <option value="created-asc">\u6700\u65e9\u521b\u5efa</option>
              </select>
            </label>
            <label class="source-gallery-filter-pill">
              <span>${TEXT.source}</span>
              <select data-source-gallery-filter="bucket">
                <option value="">${TEXT.all}</option>
              </select>
            </label>
            <label class="source-gallery-filter-pill">
              <span>${TEXT.tag}</span>
              <select data-source-gallery-filter="tag">
                <option value="">${TEXT.all}</option>
              </select>
            </label>
            <label class="source-gallery-filter-pill">
              <span>${TEXT.status}</span>
              <select data-source-gallery-filter="layer">
                <option value="">${TEXT.all}</option>
              </select>
            </label>
            <label class="source-gallery-filter-pill source-gallery-filter-pill--search">
              <span>${TEXT.search}</span>
              <input data-source-gallery-query type="search" placeholder="${TEXT.searchPlaceholder}" />
            </label>
          </div>
        </section>

        <section class="source-gallery-selectionbar hidden" data-source-gallery-selectionbar>
          <div class="source-gallery-selectionbar__summary" data-source-gallery-selection-count>${TEXT.selectedSummary(0)}</div>
          <div class="source-gallery-selectionbar__actions">
            <button type="button" class="btn btn-secondary btn-inline" data-source-gallery-batch="chat">${TEXT.importChat}</button>
            <button type="button" class="btn btn-secondary btn-inline" data-source-gallery-batch="ingest">${TEXT.batchIngest}</button>
            <button type="button" class="btn btn-secondary btn-inline" data-source-gallery-batch="inbox">${TEXT.toInbox}</button>
            <button type="button" class="btn btn-secondary btn-inline" data-source-gallery-batch="delete">${TEXT.batchDelete}</button>
            <button type="button" class="btn btn-secondary btn-inline" data-source-gallery-batch="clear">${TEXT.clearSelection}</button>
          </div>
        </section>
      </div>

      <div class="source-gallery-page__viewport">
        <section class="source-gallery-grid" data-layout="gallery-3col" data-source-gallery-grid></section>
      </div>

      <p class="source-gallery-page__status" data-source-gallery-status></p>
    </div>
  `;

  const state: PageState = {
    items: [],
    selectedIds: new Set(),
    selectedPaths: new Map(),
    refreshId: 0,
    sort: "modified-desc",
    viewMode: "sources",
    filters: { buckets: [], tags: [], layers: [] },
    selectedBuckets: [],
    selectedTags: [],
    selectedLayers: ["raw"],
  };

  const handleResize = (): void => {
    syncSourceGalleryLayout(root);
  };

  bindEvents(root, state);
  const disposeSourceSearchShortcut = bindSourceGalleryQueryShortcut(root);
  window.addEventListener("resize", handleResize);
  root.__dispose = (): void => {
    disposeSourceSearchShortcut();
    window.removeEventListener("resize", handleResize);
    closeSourceWorkspace();
  };
  syncSourceGalleryLayout(root);
  void refreshGallery(root, state);
  return root;
}

export function computeSourceGalleryRowHeight(viewportHeight: number, rowGap = SOURCE_GALLERY_ROW_GAP_PX): number {
  const availableHeight = Math.max(0, viewportHeight - rowGap);
  return Math.max(SOURCE_GALLERY_MIN_ROW_HEIGHT_PX, Math.floor(availableHeight / 2));
}

export function applySourceGalleryRowHeight(
  root: HTMLElement,
  viewportHeight: number,
  rowGap = SOURCE_GALLERY_ROW_GAP_PX,
): void {
  const rowHeight = `${computeSourceGalleryRowHeight(viewportHeight, rowGap)}px`;
  root.style.setProperty("--source-gallery-row-height", rowHeight);
  root.querySelector<HTMLElement>(".source-gallery-page")?.style.setProperty("--source-gallery-row-height", rowHeight);
}

function bindEvents(root: HTMLElement, state: PageState): void {
  root.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;

    if (target instanceof HTMLInputElement && target.dataset.sourceGallerySelect) {
      if (target.checked) {
        state.selectedIds.add(target.dataset.sourceGallerySelect);
        syncSelectedPath(state, target.dataset.sourceGallerySelect);
      } else {
        state.selectedIds.delete(target.dataset.sourceGallerySelect);
        state.selectedPaths.delete(target.dataset.sourceGallerySelect);
      }
      syncSelectionBar(root, state);
      return;
    }

    const batchButton = target.closest<HTMLButtonElement>("[data-source-gallery-batch]");
    if (batchButton) {
      void runBatchAction(root, state, batchButton.dataset.sourceGalleryBatch ?? "");
      return;
    }

    const viewButton = target.closest<HTMLButtonElement>("[data-source-gallery-view]");
    if (viewButton) {
      void openSourceWorkspace(root, state, viewButton.dataset.sourceGalleryView ?? "")
        .catch((error) => setStatus(root, error));
      return;
    }

    const cardInboxButton = target.closest<HTMLButtonElement>("[data-source-gallery-card-inbox]");
    if (cardInboxButton) {
      void post("/api/source-gallery/selection/inbox", { ids: [cardInboxButton.dataset.sourceGalleryCardInbox] })
        .then(() => setStatus(root, TEXT.movedInbox))
        .catch((error) => setStatus(root, error));
      return;
    }
  });

  root.querySelector<HTMLInputElement>("[data-source-gallery-query]")?.addEventListener("input", () => {
    void refreshGallery(root, state);
  });

  const sortSelect = root.querySelector<HTMLSelectElement>("[data-source-gallery-sort]");
  if (sortSelect) {
    sortSelect.value = state.sort;
    sortSelect.addEventListener("change", () => {
      state.sort = (sortSelect.value as SourceGallerySort) || "modified-desc";
      void refreshGallery(root, state);
    });
  }

  root.querySelectorAll<HTMLSelectElement>("[data-source-gallery-filter]").forEach((select) => {
    select.addEventListener("change", () => {
      syncFilterSelection(select, state);
      void refreshGallery(root, state);
    });
  });

  root.querySelectorAll<HTMLButtonElement>("[data-source-gallery-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      state.viewMode = button.dataset.sourceGalleryMode === "subscriptions" ? "subscriptions" : "sources";
      syncViewModeButtons(root, state.viewMode);
      void refreshGallery(root, state);
    });
  });
}

async function refreshGallery(root: HTMLElement, state: PageState): Promise<void> {
  const grid = root.querySelector<HTMLElement>("[data-source-gallery-grid]");
  if (!grid) return;
  const refreshId = state.refreshId + 1;
  state.refreshId = refreshId;
  try {
    const query = root.querySelector<HTMLInputElement>("[data-source-gallery-query]")?.value.trim() ?? "";
    const data = await request<SourceGalleryListResponse>(buildSourceGalleryRequestUrl(query, state));
    const queriedItems = query ? await searchGalleryItems(data.items, query) : data.items;
    const items = filterItemsByViewMode(queriedItems, state.viewMode);
    if (refreshId !== state.refreshId) return;
    state.items = items;
    state.filters = data.filters;
    syncSelectedPaths(state);
    syncFilterControls(root, state);
    renderCards(grid, state);
    syncSelectionBar(root, state);
    syncSourceGalleryLayout(root);
    setStatus(root, TEXT.itemCount(state.items.length));
  } catch (error) {
    setStatus(root, error);
  }
}

function syncViewModeButtons(root: HTMLElement, mode: SourceGalleryViewMode): void {
  root.querySelectorAll<HTMLButtonElement>("[data-source-gallery-mode]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.sourceGalleryMode === mode));
  });
}

function bindSourceGalleryQueryShortcut(root: HTMLElement): () => void {
  const onKeyDown = (event: KeyboardEvent): void => {
    if (!isSourceGalleryQueryShortcut(event) || event.defaultPrevented || !root.isConnected) return;
    if (document.querySelector("[data-source-gallery-workspace='true']")) return;
    const query = root.querySelector<HTMLInputElement>("[data-source-gallery-query]");
    if (!query) return;
    event.preventDefault();
    query.focus();
    query.select();
  };
  document.addEventListener("keydown", onKeyDown);
  return () => document.removeEventListener("keydown", onKeyDown);
}

function isSourceGalleryQueryShortcut(event: KeyboardEvent): boolean {
  return eventMatchesShortcut(event, getClientKeyboardShortcut("pageTextSearch"));
}

function filterItemsByViewMode(
  items: SourceGalleryItem[],
  mode: SourceGalleryViewMode,
): SourceGalleryItem[] {
  return mode === "subscriptions"
    ? items.filter(isSubscriptionSourceItem)
    : items.filter((item) => !isSubscriptionSourceItem(item));
}

function isSubscriptionSourceItem(item: SourceGalleryItem): boolean {
  const text = [
    item.path,
    item.bucket,
    item.sourceUrl,
    ...item.tags,
  ].join(" ").toLowerCase();
  return text.includes("rss") || text.includes("\u8ba2\u9605");
}

function syncSourceGalleryLayout(root: HTMLElement): void {
  const viewport = root.querySelector<HTMLElement>(".source-gallery-page__viewport");
  if (!viewport) return;
  const viewportHeight = viewport.clientHeight || Math.floor(viewport.getBoundingClientRect().height);
  if (viewportHeight <= 0) return;
  applySourceGalleryRowHeight(root, viewportHeight);
}

async function searchGalleryItems(items: SourceGalleryItem[], query: string): Promise<SourceGalleryItem[]> {
  const normalizedQuery = query.trim().toLowerCase();
  const search = await request<SearchApiResponse>(
    `/api/search?scope=local&mode=hybrid&q=${encodeURIComponent(query)}`,
  );
  const rankByPath = new Map(search.local.results.map((result, index) => [normalizePath(result.path), index]));
  return items
    .filter((item) => {
      const normalizedPath = normalizePath(item.path);
      return rankByPath.has(normalizedPath) || sourceGalleryItemMatchesQuery(item, normalizedQuery);
    })
    .sort((left, right) => getSearchRank(rankByPath, left) - getSearchRank(rankByPath, right));
}

function sourceGalleryItemMatchesQuery(item: SourceGalleryItem, normalizedQuery: string): boolean {
  if (!normalizedQuery) return true;
  return [
    item.title,
    item.excerpt,
    item.path,
    item.bucket,
    item.sourceUrl,
    ...item.tags,
  ].filter(Boolean).join("\n").toLowerCase().includes(normalizedQuery);
}

function getSearchRank(rankByPath: Map<string, number>, item: SourceGalleryItem): number {
  return rankByPath.get(normalizePath(item.path)) ?? Number.MAX_SAFE_INTEGER;
}

function renderCards(grid: HTMLElement, state: PageState): void {
  const cards = state.items.map((item) => `
    <article class="source-gallery-card source-gallery-grid__cell panel">
      <label class="source-gallery-card__check">
        <input type="checkbox" data-source-gallery-select="${escapeHtml(item.id)}" ${state.selectedIds.has(item.id) ? "checked" : ""} />
      </label>
      <div class="source-gallery-card__media">
        ${item.previewImageUrl
          ? `<img src="${escapeHtml(item.previewImageUrl)}" alt="${escapeHtml(item.title)}" />`
          : `<div class="source-gallery-card__excerpt">${escapeHtml(buildCardExcerpt(item))}</div>`}
      </div>
      <div class="source-gallery-card__body">
        <h3 title="${escapeHtml(resolveCardTitle(item))}">${escapeHtml(resolveCardTitle(item))}</h3>
        <div class="source-gallery-card__meta">
          <span class="source-gallery-badge">${escapeHtml(item.layer === "source" ? "sources_full" : "raw")}</span>
          <span class="source-gallery-badge is-soft">${escapeHtml(item.bucket)}</span>
          ${item.mediaCount > 0 ? `<span class="source-gallery-badge is-soft">${escapeHtml(formatMediaKinds(item.mediaKinds))}</span>` : ""}
        </div>
        <div class="source-gallery-card__tags">
          ${item.tags.slice(0, 6).map((tag) => `<span class="source-gallery-tag">${escapeHtml(tag)}</span>`).join("")}
        </div>
      </div>
      <footer class="source-gallery-card__footer">
        <span>${escapeHtml(formatDate(item.modifiedAt))}</span>
        <div class="source-gallery-card__actions">
          <button type="button" class="icon-btn source-gallery-card__icon-action" aria-label="${TEXT.openOriginal}" title="${TEXT.openOriginal}" data-source-gallery-view="${escapeHtml(item.id)}"><span aria-hidden="true">\u2197</span></button>
          <button type="button" class="icon-btn source-gallery-card__icon-action" aria-label="${TEXT.toInbox}" title="${TEXT.toInbox}" data-source-gallery-card-inbox="${escapeHtml(item.id)}"><span aria-hidden="true">\u21aa</span></button>
        </div>
      </footer>
    </article>
  `).join("");

  grid.innerHTML = cards;
}

function syncSelectionBar(root: HTMLElement, state: PageState): void {
  const selectionBar = root.querySelector<HTMLElement>("[data-source-gallery-selectionbar]");
  const count = root.querySelector<HTMLElement>("[data-source-gallery-selection-count]");
  if (!selectionBar || !count) return;
  selectionBar.classList.toggle("hidden", state.selectedIds.size === 0);
  count.textContent = TEXT.selectedSummary(state.selectedIds.size);
  syncSourceGalleryLayout(root);
}

async function runBatchAction(root: HTMLElement, state: PageState, action: string): Promise<void> {
  const ids = [...state.selectedIds];
  if (ids.length === 0) return;
  if (action === "clear") {
    state.selectedIds.clear();
    state.selectedPaths.clear();
    renderCards(root.querySelector<HTMLElement>("[data-source-gallery-grid]")!, state);
    syncSelectionBar(root, state);
    return;
  }
  if (action === "chat") {
    const refs = ids
      .map((id) => state.selectedPaths.get(id))
      .filter((path): path is string => Boolean(path));
    window.localStorage.setItem("llmWiki.pendingChatArticleRefs", JSON.stringify(refs));
    window.location.hash = "#/chat";
    return;
  }
  try {
    if (action === "inbox") {
      await post("/api/source-gallery/selection/inbox", { ids });
      setStatus(root, TEXT.movedInbox);
    }
    if (action === "ingest") {
      await post("/api/source-gallery/selection/ingest", { ids });
      setStatus(root, TEXT.queuedIngest);
    }
    if (action === "delete") {
      await deleteSources(root, state, ids, false);
      return;
    }
  } catch (error) {
    setStatus(root, error);
  }
}

async function openSourceWorkspace(root: HTMLElement, state: PageState, id: string): Promise<void> {
  if (!id) return;
  const detail = await request<SourceGalleryDetail>(`/api/source-gallery/${encodeURIComponent(id)}`);
  const conversation = await ensureSourceWorkspaceConversation(detail);
  closeSourceWorkspace();
  const workspace = document.createElement("section") as SourceWorkspaceElement;
  workspace.className = "source-gallery-workspace";
  workspace.dataset.sourceGalleryWorkspace = "true";
  workspace.dataset.sourceWorkspaceOrder = "content-first";
  workspace.dataset.sourceWorkspaceId = detail.id;
  workspace.dataset.sourceWorkspaceConversationId = conversation.id;
  workspace.style.setProperty("--source-workspace-side-width", "420px");
  workspace.innerHTML = `
    <div class="source-gallery-workspace__shell">
      <header class="source-gallery-workspace__header">
        <div>
          <div class="eyebrow">${TEXT.fullPreview}</div>
          <h2>${escapeHtml(detail.title)}</h2>
          <p>${escapeHtml(detail.path)}</p>
        </div>
        <div class="source-gallery-workspace__actions">
          <button type="button" class="btn btn-secondary btn-inline" data-source-workspace-swap>${TEXT.swapPane}</button>
          <button type="button" class="btn btn-secondary btn-inline" data-source-workspace-delete="${escapeHtml(detail.id)}">${TEXT.delete}</button>
          <button type="button" class="btn btn-primary btn-inline" data-source-workspace-close>${TEXT.close}</button>
        </div>
      </header>
      <div class="source-gallery-workspace__body">
        <article class="source-gallery-workspace__pane source-gallery-workspace__pane--content">
          <div class="source-gallery-workspace__meta">
            <span class="source-gallery-badge is-soft">${escapeHtml(formatMediaKinds(detail.mediaKinds))}</span>
            <span class="source-gallery-badge is-soft">${escapeHtml(TEXT.ocrReady(detail.ocrTextPath))}</span>
            <span class="source-gallery-badge is-soft">${escapeHtml(TEXT.transcriptReady(detail.transcriptPath))}</span>
          </div>
          ${detail.previewImageUrl ? `<img class="source-gallery-workspace__image" src="${escapeHtml(detail.previewImageUrl)}" alt="${escapeHtml(detail.title)}" />` : ""}
          ${renderEmbeddedMedia(detail.media)}
          <div class="source-gallery-workspace__rendered">${detail.html || `<pre>${escapeHtml(detail.raw)}</pre>`}</div>
        </article>
        <div class="source-gallery-workspace__divider" data-source-workspace-resize></div>
        <aside class="source-gallery-workspace__pane source-gallery-workspace__pane--chat">
          <div class="source-gallery-workspace__chat-head">
            <div>
              <div class="eyebrow">GUIDED INGEST</div>
              <h3>${TEXT.guideTitle}</h3>
              <p>${TEXT.guideSubtitle}</p>
            </div>
          </div>
          <div class="source-gallery-workspace__messages" data-source-workspace-messages></div>
          <form class="source-gallery-workspace__composer" data-source-workspace-form="${escapeHtml(detail.id)}">
            <textarea data-source-workspace-input="${escapeHtml(detail.id)}" placeholder="${TEXT.chatPlaceholder}" rows="4"></textarea>
            <div class="source-gallery-workspace__composer-actions">
              <button type="button" class="btn btn-secondary" data-source-workspace-compile="${escapeHtml(detail.id)}">${TEXT.queueCompile}</button>
              <button type="button" class="btn btn-primary" data-source-workspace-send="${escapeHtml(detail.id)}">${TEXT.send}</button>
            </div>
          </form>
        </aside>
      </div>
    </div>
  `;
  workspace.__disposeSearchShortcut = bindPageSearchShortcut(
    workspace,
    () => workspace.querySelector<HTMLElement>(".source-gallery-workspace__pane--content"),
  );
  bindSourceWorkspaceResize(workspace);
  const form = workspace.querySelector<HTMLFormElement>("[data-source-workspace-form]");
  const sendButton = workspace.querySelector<HTMLButtonElement>("[data-source-workspace-send]");
  const compileButton = workspace.querySelector<HTMLButtonElement>("[data-source-workspace-compile]");
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    void sendSourceWorkspaceMessage(root, state, detail.id);
  });
  sendButton?.addEventListener("click", () => {
    void sendSourceWorkspaceMessage(root, state, detail.id);
  });
  compileButton?.addEventListener("click", () => {
    void queueSourceWorkspaceCompile(root, state, detail.id);
  });
  workspace.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    if (target.closest("[data-source-workspace-close]")) {
      closeSourceWorkspace();
      return;
    }
    const deleteButton = target.closest<HTMLElement>("[data-source-workspace-delete]");
    if (deleteButton) {
      void deleteSources(root, state, [deleteButton.getAttribute("data-source-workspace-delete") ?? ""])
        .catch((error) => setStatus(root, error));
      return;
    }
    if (target.closest("[data-source-workspace-swap]")) {
      toggleSourceWorkspaceOrder();
    }
  });
  renderSourceWorkspaceConversation(workspace, conversation);
  document.body.appendChild(workspace);
}

function closeSourceWorkspace(): void {
  const workspace = document.querySelector<SourceWorkspaceElement>("[data-source-gallery-workspace='true']");
  workspace?.__disposeSearchShortcut?.();
  workspace?.remove();
}

function toggleSourceWorkspaceOrder(): void {
  const workspace = document.querySelector<HTMLElement>("[data-source-gallery-workspace='true']");
  if (!workspace) return;
  workspace.dataset.sourceWorkspaceOrder = workspace.dataset.sourceWorkspaceOrder === "chat-first"
    ? "content-first"
    : "chat-first";
}

async function ensureSourceWorkspaceConversation(detail: SourceGalleryDetail): Promise<ChatConversation> {
  const storageKey = `llmWiki.sourceWorkspaceConversation:${detail.id}`;
  const existingId = window.localStorage.getItem(storageKey);
  if (existingId) {
    try {
      return await request<ChatConversation>(`/api/chat/${encodeURIComponent(existingId)}`);
    } catch {
      window.localStorage.removeItem(storageKey);
    }
  }
  const conversation = await post<ChatConversation>("/api/chat", {
    title: `源料录入：${detail.title}`,
    articleRefs: [detail.path],
    searchScope: "local",
    agentId: "wiki-general",
  });
  window.localStorage.setItem(storageKey, conversation.id);
  return conversation;
}

async function sendSourceWorkspaceMessage(root: HTMLElement, state: PageState, id: string): Promise<void> {
  const workspace = document.querySelector<HTMLElement>("[data-source-gallery-workspace='true']");
  if (!workspace) return;
  const input = workspace.querySelector<HTMLTextAreaElement>("[data-source-workspace-input]");
  const conversationId = workspace.dataset.sourceWorkspaceConversationId;
  if (!input || !conversationId) return;
  const content = input.value.trim();
  if (!content) return;
  setSourceWorkspaceComposerBusy(workspace, true);
  try {
    const detail = await request<SourceGalleryDetail>(`/api/source-gallery/${encodeURIComponent(id)}`);
    const conversation = await post<ChatConversation>(
      `/api/chat/${encodeURIComponent(conversationId)}/messages`,
      { content, articleRefs: [detail.path] },
    );
    input.value = "";
    renderSourceWorkspaceConversation(workspace, conversation);
    setStatus(root, `已更新对话：${detail.title}`);
    await refreshGallery(root, state);
  } catch (error) {
    setStatus(root, error);
  } finally {
    setSourceWorkspaceComposerBusy(workspace, false);
  }
}

async function queueSourceWorkspaceCompile(root: HTMLElement, state: PageState, id: string): Promise<void> {
  const workspace = document.querySelector<HTMLElement>("[data-source-gallery-workspace='true']");
  if (!workspace) return;
  const conversationId = workspace.dataset.sourceWorkspaceConversationId;
  if (!conversationId) return;
  setSourceWorkspaceComposerBusy(workspace, true);
  try {
    const result = await post<SourceWorkspaceCompileResult>(
      `/api/source-gallery/${encodeURIComponent(id)}/compile`,
      { conversationId },
    );
    setStatus(root, TEXT.compileQueued(result.inputPath));
    await refreshGallery(root, state);
  } catch (error) {
    setStatus(root, error);
  } finally {
    setSourceWorkspaceComposerBusy(workspace, false);
  }
}

function renderSourceWorkspaceConversation(workspace: HTMLElement, conversation: ChatConversation): void {
  workspace.dataset.sourceWorkspaceConversationId = conversation.id;
  const messages = workspace.querySelector<HTMLElement>("[data-source-workspace-messages]");
  if (!messages) return;
  messages.innerHTML = conversation.messages.length > 0
    ? conversation.messages.map((message) => `
        <article class="chat-message chat-message--${escapeHtml(message.role)}">
          <div class="chat-message__body">${escapeHtml(message.content)}</div>
        </article>
      `).join("")
    : `<div class="chat-empty-state"><p class="chat-empty-state__title">${TEXT.guideTitle}</p><p class="muted">${TEXT.guideSubtitle}</p></div>`;
  messages.scrollTop = messages.scrollHeight;
}

function bindSourceWorkspaceResize(workspace: HTMLElement): void {
  const divider = workspace.querySelector<HTMLElement>("[data-source-workspace-resize]");
  const body = workspace.querySelector<HTMLElement>(".source-gallery-workspace__body");
  if (!divider || !body) return;
  divider.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    const onMove = (moveEvent: PointerEvent) => {
      const rect = body.getBoundingClientRect();
      const rawWidth = workspace.dataset.sourceWorkspaceOrder === "chat-first"
        ? moveEvent.clientX - rect.left
        : rect.right - moveEvent.clientX;
      const nextWidth = Math.min(720, Math.max(320, rawWidth));
      workspace.style.setProperty("--source-workspace-side-width", `${nextWidth}px`);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  });
}

function setSourceWorkspaceComposerBusy(workspace: HTMLElement, busy: boolean): void {
  workspace.querySelectorAll<HTMLButtonElement>(
    "[data-source-workspace-send], [data-source-workspace-compile]",
  ).forEach((button) => {
    button.disabled = busy;
  });
  const input = workspace.querySelector<HTMLTextAreaElement>("[data-source-workspace-input]");
  if (input) {
    input.disabled = busy;
  }
}

async function deleteSources(
  root: HTMLElement,
  state: PageState,
  ids: string[],
  closeModalAfterDelete = true,
): Promise<void> {
  const filteredIds = ids.filter(Boolean);
  if (filteredIds.length === 0) return;
  const result = await del<SourceGalleryDeleteResult>("/api/source-gallery", { ids: filteredIds });
  if (result.deleted.length === 0) {
    throw new Error(TEXT.noDeleted);
  }
  for (const id of filteredIds) {
    state.selectedIds.delete(id);
    state.selectedPaths.delete(id);
  }
  if (closeModalAfterDelete) {
    closeSourceWorkspace();
  }
  setStatus(root, TEXT.deletedCount(result.deleted.length));
  await refreshGallery(root, state);
}

async function request<T>(url: string): Promise<T> {
  const response = await fetch(url);
  const payload = (await response.json()) as ApiResponse<T>;
  if (!response.ok || !payload.success || payload.data === undefined) {
    throw new Error(payload.error ?? `request failed: ${url}`);
  }
  return payload.data;
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json()) as ApiResponse<T>;
  if (!response.ok || !payload.success || payload.data === undefined) {
    throw new Error(payload.error ?? `request failed: ${url}`);
  }
  return payload.data;
}

async function del<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json()) as ApiResponse<T>;
  if (!response.ok || !payload.success || payload.data === undefined) {
    throw new Error(payload.error ?? `request failed: ${url}`);
  }
  return payload.data;
}

function setStatus(root: HTMLElement, value: unknown): void {
  const status = root.querySelector<HTMLElement>("[data-source-gallery-status]");
  if (!status) return;
  status.textContent = value instanceof Error ? value.message : String(value);
}

function buildSourceGalleryRequestUrl(query: string, state: PageState): string {
  const params = new URLSearchParams();
  if (query) {
    params.set("query", query);
  }
  params.set("sort", state.sort);
  if (state.selectedBuckets.length > 0) {
    params.set("buckets", state.selectedBuckets.join(","));
  }
  if (state.selectedTags.length > 0) {
    params.set("tags", state.selectedTags.join(","));
  }
  if (state.selectedLayers.length > 0) {
    params.set("layers", state.selectedLayers.join(","));
  }
  return `/api/source-gallery?${params.toString()}`;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString();
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/");
}

function syncSelectedPath(state: PageState, id: string): void {
  const item = state.items.find((entry) => entry.id === id);
  if (item) {
    state.selectedPaths.set(id, item.path);
  }
}

function syncSelectedPaths(state: PageState): void {
  for (const id of state.selectedIds) {
    syncSelectedPath(state, id);
  }
}

function syncFilterSelection(select: HTMLSelectElement, state: PageState): void {
  const key = select.dataset.sourceGalleryFilter;
  const value = select.value.trim();
  if (key === "bucket") {
    state.selectedBuckets = value ? [value] : [];
    return;
  }
  if (key === "tag") {
    state.selectedTags = value ? [value] : [];
    return;
  }
  if (key === "layer") {
    state.selectedLayers = value === "raw" || value === "source" ? [value] : [];
  }
}

function syncFilterControls(root: HTMLElement, state: PageState): void {
  syncFilterSelect(
    root.querySelector<HTMLSelectElement>("[data-source-gallery-filter='bucket']"),
    state.filters.buckets,
    state.selectedBuckets[0],
  );
  syncFilterSelect(
    root.querySelector<HTMLSelectElement>("[data-source-gallery-filter='tag']"),
    state.filters.tags,
    state.selectedTags[0],
  );
  syncFilterSelect(
    root.querySelector<HTMLSelectElement>("[data-source-gallery-filter='layer']"),
    state.filters.layers,
    state.selectedLayers[0],
  );
}

function syncFilterSelect(select: HTMLSelectElement | null, values: string[], selected?: string): void {
  if (!select) return;
  const currentValue = selected && values.includes(selected) ? selected : "";
  select.innerHTML = [
    `<option value="">${TEXT.all}</option>`,
    ...values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`),
  ].join("");
  select.value = currentValue;
}

function resolveCardTitle(item: SourceGalleryItem): string {
  const preferred = item.title.trim();
  if (preferred && preferred.length < 160) {
    return preferred;
  }
  const basename = item.path.split(/[\\/]/).pop() ?? item.id;
  return basename.replace(/\.(md|markdown|txt)$/i, "");
}

function buildCardExcerpt(item: SourceGalleryItem): string {
  const cleaned = item.excerpt
    .replace(/^\u539f\u6599\u6765\u6e90:.*$/gmu, "")
    .replace(/^\u94fe\u63a5:\s*.*$/gmu, "")
    .replace(/^\u8def\u5f84:\s*.*$/gmu, "")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned) {
    return cleaned.slice(0, 220);
  }
  return item.sourceUrl ? `${TEXT.sourcePrefix}${item.sourceUrl}` : TEXT.noExcerpt;
}

function formatMediaKinds(kinds: Array<"image" | "pdf" | "video" | "audio">): string {
  return kinds.length > 0 ? kinds.join(" / ") : TEXT.noMedia;
}

function renderEmbeddedMedia(media: SourceGalleryDetail["media"]): string {
  if (media.length === 0) return "";
  const blocks = media.map((item, index) => {
    const title = escapeHtml(item.path.split("/").pop() ?? item.path);
    const url = item.url ? escapeHtml(item.url) : "";
    if (!url) {
      return `<div class="source-gallery-media-embed source-gallery-media-embed--missing"><span>${title}</span></div>`;
    }
    if (item.kind === "image") {
      return `<figure class="source-gallery-media-embed source-gallery-media-embed--image"><img src="${url}" alt="${title}" loading="lazy" /><figcaption>${title}</figcaption></figure>`;
    }
    if (item.kind === "video") {
      return `<figure class="source-gallery-media-embed source-gallery-media-embed--video"><video src="${url}" controls preload="metadata"></video><figcaption>${title}</figcaption></figure>`;
    }
    if (item.kind === "audio") {
      return `<figure class="source-gallery-media-embed source-gallery-media-embed--audio"><audio src="${url}" controls preload="metadata"></audio><figcaption>${title}</figcaption></figure>`;
    }
    return `<a class="source-gallery-media-embed source-gallery-media-embed--file" href="${url}" target="_blank" rel="noreferrer">附件 ${index + 1}: ${title}</a>`;
  });
  return `<div class="source-gallery-media-grid">${blocks.join("")}</div>`;
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
