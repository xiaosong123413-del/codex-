interface WikiComment {
  id: string;
  path: string;
  quote: string;
  text: string;
  start: number;
  end: number;
  resolved: boolean;
  createdAt: string;
}

export interface WikiCommentSelection {
  quote: string;
  start: number;
  end: number;
}

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

interface WikiCommentPagePayload {
  path: string;
  title: string | null;
  html: string;
  raw: string;
  frontmatter: Record<string, unknown> | null;
  aliases?: string[];
  sizeBytes?: number;
  modifiedAt?: string;
  sourceEditable?: boolean;
}

interface WikiCommentAiDraft {
  id: string;
  commentId: string;
  pagePath: string;
  diffText: string;
}

interface WikiCommentAiDraftConfirmPayload {
  id: string;
  pagePath: string;
  page: WikiCommentPagePayload;
}

type WikiCommentCardPhase = "idle" | "generating" | "confirming" | "discarding";

interface WikiCommentCardState {
  phase: WikiCommentCardPhase;
  error: string | null;
  draft: WikiCommentAiDraft | null;
}

interface WikiCommentSurfaceDocumentOptions {
  sourceEditable: boolean;
  refreshPage: (page: WikiCommentPagePayload) => void;
  loadOnSet?: boolean;
  contentAlreadyRendered?: boolean;
}

interface WikiCommentSurfaceOptions {
  content: HTMLElement;
  list: HTMLElement;
  status: HTMLElement;
  panel: HTMLElement;
  addButton?: HTMLButtonElement;
  closeButton?: HTMLButtonElement;
  emptyLabel: string;
}

export interface WikiCommentSurfaceController {
  setDocument(path: string, html: string, options?: WikiCommentSurfaceDocumentOptions): Promise<void>;
  clear(message: string): void;
  toggle(): void;
  createFromSelection(selection: WikiCommentSelection | null): Promise<void>;
}

const DEFAULT_DOCUMENT_OPTIONS: WikiCommentSurfaceDocumentOptions = {
  sourceEditable: false,
  refreshPage: () => {},
};

export function createWikiCommentSurface(options: WikiCommentSurfaceOptions): WikiCommentSurfaceController {
  const { content, list, status, panel, addButton, closeButton, emptyLabel } = options;
  let currentPath = "";
  let baseHtml = "";
  let comments: WikiComment[] = [];
  let sourceEditable = false;
  let refreshPage = DEFAULT_DOCUMENT_OPTIONS.refreshPage;
  let documentGeneration = 0;
  let commentsRequestSeq = 0;
  let commentsLoaded = false;
  const cardStates = new Map<string, WikiCommentCardState>();
  const layout = panel.parentElement as HTMLElement | null;
  const inlinePanel = Boolean(addButton);

  setPanelOpen(inlinePanel);

  closeButton?.addEventListener("click", () => {
    setPanelOpen(false);
  });
  addButton?.addEventListener("click", () => {
    setPanelOpen(true);
    void createCommentFromSelection();
  });

  // fallow-ignore-next-line complexity
  list.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const card = target.closest<HTMLElement>("[data-wiki-comments-card]");
    const id = card?.dataset.wikiCommentsCard ?? "";
    if (!id) {
      return;
    }
    if (target.closest("[data-wiki-comments-save]")) {
      void saveComment(id);
      return;
    }
    if (target.closest("[data-wiki-comments-resolve]")) {
      const comment = comments.find((item) => item.id === id);
      if (!comment) {
        return;
      }
      void patchComment(id, { resolved: !comment.resolved });
      return;
    }
    if (target.closest("[data-wiki-comments-delete]")) {
      void deleteComment(id);
      return;
    }
    if (target.closest("[data-wiki-comments-ai-resolve]")) {
      void createAiDraft(id);
      return;
    }
    if (target.closest("[data-wiki-comments-ai-confirm]")) {
      void confirmAiDraft(id);
      return;
    }
    if (target.closest("[data-wiki-comments-ai-discard]")) {
      void discardAiDraft(id);
    }
  });

  return {
    async setDocument(path: string, html: string, documentOptions: WikiCommentSurfaceDocumentOptions = DEFAULT_DOCUMENT_OPTIONS): Promise<void> {
      documentGeneration += 1;
      currentPath = path;
      baseHtml = html;
      sourceEditable = documentOptions.sourceEditable;
      refreshPage = documentOptions.refreshPage;
      commentsLoaded = false;
      cardStates.clear();
      if (!documentOptions.contentAlreadyRendered) {
        content.innerHTML = html;
      }
      if (!path) {
        comments = [];
        renderComments();
        return;
      }
      if (documentOptions.loadOnSet === false) {
        comments = [];
        list.innerHTML = `<p class="wiki-comments-panel__empty">${escapeHtml(emptyLabel)}</p>`;
        status.textContent = "打开评论面板后读取评论。";
        return;
      }
      await refreshComments();
    },
    clear(message: string): void {
      documentGeneration += 1;
      currentPath = "";
      baseHtml = "";
      comments = [];
      sourceEditable = false;
      refreshPage = DEFAULT_DOCUMENT_OPTIONS.refreshPage;
      commentsLoaded = false;
      cardStates.clear();
      setPanelOpen(false);
      list.innerHTML = `<p class="wiki-comments-panel__empty">${escapeHtml(emptyLabel)}</p>`;
      status.textContent = message;
    },
    toggle(): void {
      const shouldOpen = panel.hidden;
      setPanelOpen(shouldOpen);
      if (shouldOpen) {
        loadCommentsIfNeeded();
      }
    },
    async createFromSelection(selection: WikiCommentSelection | null): Promise<void> {
      await createCommentFromSelection(selection);
    },
  };

  // fallow-ignore-next-line complexity
  async function refreshComments(): Promise<void> {
    if (!currentPath) {
      comments = [];
      renderComments();
      commentsLoaded = true;
      return;
    }
    const requestPath = currentPath;
    const requestSeq = ++commentsRequestSeq;
    status.textContent = "正在读取评论...";
    try {
      const response = await fetch(`/api/wiki-comments?path=${encodeURIComponent(requestPath)}`);
      const payload = await readApiResponse<WikiComment[]>(response, "读取评论失败。");
      if (requestSeq !== commentsRequestSeq || requestPath !== currentPath) {
        return;
      }
      if (!response.ok || !payload.success || !payload.data) {
        throw new Error(payload.error ?? "failed to load comments");
      }
      comments = payload.data;
      commentsLoaded = true;
      syncCardStates();
      renderComments();
      status.textContent = comments.length > 0
        ? `已加载 ${comments.length} 条评论。`
        : "选中文本后点击浮动“评论”，即可新增评论。";
    } catch (error) {
      if (requestSeq !== commentsRequestSeq || requestPath !== currentPath) {
        return;
      }
      comments = [];
      commentsLoaded = true;
      renderComments();
      status.textContent = error instanceof Error ? error.message : String(error);
    }
  }

  function loadCommentsIfNeeded(): void {
    if (!currentPath || commentsLoaded) {
      return;
    }
    void refreshComments();
  }

  // fallow-ignore-next-line complexity
  async function createCommentFromSelection(selection: WikiCommentSelection | null = locateSelection(content)): Promise<void> {
    if (!currentPath) {
      status.textContent = "当前页面不支持评论。";
      return;
    }
    if (!selection) {
      status.textContent = "先选中文本，再点击浮动“评论”。";
      return;
    }
    const requestPath = currentPath;
    const requestGeneration = documentGeneration;
    setPanelOpen(true);
    status.textContent = "正在创建评论...";
    try {
      const response = await fetch("/api/wiki-comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: requestPath,
          quote: selection.quote,
          text: "",
          start: selection.start,
          end: selection.end,
        }),
      });
      const payload = await readApiResponse<WikiComment>(response, "创建评论失败。");
      if (!response.ok || !payload.success || !payload.data) {
        throw new Error(payload.error ?? "failed to create comment");
      }
      if (!isActiveDocument(requestPath, requestGeneration)) {
        return;
      }
      await refreshComments();
      if (!isActiveDocument(requestPath, requestGeneration)) {
        return;
      }
      if (!focusCommentInput(payload.data.id)) {
        comments = mergeCreatedComment(comments, payload.data);
        syncCardStates();
        renderComments();
        focusCommentInput(payload.data.id);
      }
      status.textContent = "评论已创建，请在侧栏补充内容。";
    } catch (error) {
      if (!isActiveDocument(requestPath, requestGeneration)) {
        return;
      }
      status.textContent = error instanceof Error ? error.message : String(error);
    }
  }

  async function saveComment(id: string): Promise<void> {
    const textarea = list.querySelector<HTMLTextAreaElement>(`[data-wiki-comments-input="${cssEscape(id)}"]`);
    if (!textarea) {
      return;
    }
    await patchComment(id, { text: textarea.value });
  }

  async function patchComment(id: string, patch: { text?: string; resolved?: boolean }): Promise<void> {
    if (!currentPath) {
      return;
    }
    status.textContent = "正在保存评论...";
    try {
      const response = await fetch(`/api/wiki-comments/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: currentPath,
          ...patch,
        }),
      });
      const payload = await readApiResponse<WikiComment>(response, "更新评论失败。");
      if (!response.ok || !payload.success || !payload.data) {
        throw new Error(payload.error ?? "failed to update comment");
      }
      await refreshComments();
      status.textContent = payload.data.resolved ? "评论已解决。" : "评论已保存。";
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : String(error);
    }
  }

  async function deleteComment(id: string): Promise<void> {
    if (!currentPath) {
      return;
    }
    status.textContent = "正在删除评论...";
    try {
      const response = await fetch(`/api/wiki-comments/${encodeURIComponent(id)}?path=${encodeURIComponent(currentPath)}`, {
        method: "DELETE",
      });
      const payload = await readApiResponse<null>(response, "删除评论失败。");
      if (!response.ok || !payload.success) {
        throw new Error(payload.error ?? "failed to delete comment");
      }
      await refreshComments();
      status.textContent = "评论已删除。";
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : String(error);
    }
  }

  async function createAiDraft(id: string): Promise<void> {
    const comment = comments.find((item) => item.id === id);
    if (!comment || !canAiResolve(comment)) {
      return;
    }
    setCardState(id, {
      phase: "generating",
      error: null,
      draft: null,
    });
    status.textContent = "正在生成 AI 草案...";
    renderComments();
    try {
      const response = await fetch(`/api/wiki-comments/${encodeURIComponent(id)}/ai-draft`, {
        method: "POST",
      });
      const payload = await readApiResponse<WikiCommentAiDraft>(response, "生成 AI 草案失败。");
      if (!response.ok || !payload.success || !payload.data) {
        throw new Error(payload.error ?? "failed to create ai draft");
      }
      setCardState(id, {
        phase: "idle",
        error: null,
        draft: payload.data,
      });
      renderComments();
      status.textContent = "AI 草案已生成，请确认写回。";
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setCardState(id, {
        phase: "idle",
        error: message,
        draft: null,
      });
      renderComments();
      status.textContent = message;
    }
  }

  // fallow-ignore-next-line complexity
  async function confirmAiDraft(id: string): Promise<void> {
    const cardState = getCardState(id);
    if (!cardState.draft) {
      return;
    }
    const requestPath = currentPath;
    const requestGeneration = documentGeneration;
    setCardState(id, {
      phase: "confirming",
      error: null,
      draft: cardState.draft,
    });
    status.textContent = "正在写回草案...";
    renderComments();
    try {
      const response = await fetch(
        `/api/wiki-comments/${encodeURIComponent(id)}/ai-draft/${encodeURIComponent(cardState.draft.id)}/confirm`,
        { method: "POST" },
      );
      const payload = await readApiResponse<WikiCommentAiDraftConfirmPayload>(response, "确认写回失败。");
      if (!response.ok || !payload.success || !payload.data?.page) {
        throw new Error(payload.error ?? "failed to confirm ai draft");
      }
      if (!isActiveDocument(requestPath, requestGeneration)) {
        return;
      }
      applyConfirmedPage(payload.data.page);
      await refreshComments();
      if (!isActiveDocument(requestPath, requestGeneration)) {
        return;
      }
      status.textContent = "评论已解决";
    } catch (error) {
      if (!isActiveDocument(requestPath, requestGeneration)) {
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      setCardState(id, {
        phase: "idle",
        error: message,
        draft: cardState.draft,
      });
      renderComments();
      status.textContent = message;
    }
  }

  async function discardAiDraft(id: string): Promise<void> {
    const cardState = getCardState(id);
    if (!cardState.draft) {
      return;
    }
    setCardState(id, {
      phase: "discarding",
      error: null,
      draft: cardState.draft,
    });
    renderComments();
    try {
      const response = await fetch(
        `/api/wiki-comments/${encodeURIComponent(id)}/ai-draft/${encodeURIComponent(cardState.draft.id)}`,
        { method: "DELETE" },
      );
      const payload = await readApiResponse<null>(response, "放弃草案失败。");
      if (!response.ok || !payload.success) {
        throw new Error(payload.error ?? "failed to discard ai draft");
      }
      setCardState(id, {
        phase: "idle",
        error: null,
        draft: null,
      });
      renderComments();
      status.textContent = "已放弃草案。";
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setCardState(id, {
        phase: "idle",
        error: message,
        draft: cardState.draft,
      });
      renderComments();
      status.textContent = message;
    }
  }

  function renderComments(): void {
    content.innerHTML = baseHtml;
    applyHighlights(content, comments);
    if (comments.length === 0) {
      list.innerHTML = `<p class="wiki-comments-panel__empty">${escapeHtml(emptyLabel)}</p>`;
      return;
    }
    list.innerHTML = comments.map((comment) => renderCommentCard(comment)).join("");
  }

  function setPanelOpen(open: boolean): void {
    panel.hidden = !open;
    if (layout) {
      layout.dataset.wikiCommentsOpen = open ? "true" : "false";
    }
  }

  function focusCommentInput(id: string): boolean {
    const textarea = list.querySelector<HTMLTextAreaElement>(`[data-wiki-comments-input="${cssEscape(id)}"]`);
    if (!textarea) {
      return false;
    }
    textarea.focus();
    const valueLength = textarea.value.length;
    textarea.setSelectionRange(valueLength, valueLength);
    return true;
  }

  function renderCommentCard(comment: WikiComment): string {
    const cardState = getCardState(comment.id);
    const disabled = cardState.phase === "idle" ? "" : "disabled";
    const error = cardState.error
      ? `<p class="wiki-comments-panel__error">${escapeHtml(cardState.error)}</p>`
      : "";

    if (cardState.draft) {
      return `
        <article class="wiki-comments-panel__card wiki-comments-panel__card--review" data-wiki-comments-card="${escapeHtml(comment.id)}">
          <blockquote>${escapeHtml(comment.quote)}</blockquote>
          <pre class="wiki-comments-panel__diff">${escapeHtml(cardState.draft.diffText)}</pre>
          ${error}
          <div class="wiki-comments-panel__actions">
            <button type="button" class="btn btn-primary btn-inline" data-wiki-comments-ai-confirm ${disabled}>确认写回</button>
            <button type="button" class="btn btn-secondary btn-inline" data-wiki-comments-ai-discard ${disabled}>放弃草案</button>
          </div>
        </article>
      `;
    }

    const aiResolveButton = canAiResolve(comment)
      ? `<button type="button" class="btn btn-secondary btn-inline" data-wiki-comments-ai-resolve ${disabled}>AI自动解决</button>`
      : "";

    return `
      <article class="wiki-comments-panel__card" data-wiki-comments-card="${escapeHtml(comment.id)}">
        <blockquote>${escapeHtml(comment.quote)}</blockquote>
        <textarea class="wiki-comments-panel__input" data-wiki-comments-input="${escapeHtml(comment.id)}" ${disabled}>${escapeHtml(comment.text)}</textarea>
        ${error}
        <div class="wiki-comments-panel__actions">
          <button type="button" class="btn btn-secondary btn-inline" data-wiki-comments-save ${disabled}>保存</button>
          <button type="button" class="btn btn-secondary btn-inline" data-wiki-comments-resolve ${disabled}>${comment.resolved ? "重新打开" : "解决"}</button>
          <button type="button" class="btn btn-secondary btn-inline" data-wiki-comments-delete ${disabled}>删除</button>
          ${aiResolveButton}
        </div>
      </article>
    `;
  }

  function applyConfirmedPage(page: WikiCommentPagePayload): void {
    currentPath = page.path;
    baseHtml = page.html || "";
    sourceEditable = Boolean(page.sourceEditable);
    content.innerHTML = baseHtml;
    refreshPage(page);
  }

  function canAiResolve(comment: WikiComment): boolean {
    return sourceEditable && !comment.resolved && comment.text.trim().length > 0;
  }

  function syncCardStates(): void {
    const activeIds = new Set(comments.map((comment) => comment.id));
    for (const [id] of cardStates) {
      if (!activeIds.has(id)) {
        cardStates.delete(id);
      }
    }
    for (const comment of comments) {
      const state = cardStates.get(comment.id);
      if (!state) {
        continue;
      }
      if (comment.resolved) {
        cardStates.delete(comment.id);
      }
    }
  }

  function getCardState(id: string): WikiCommentCardState {
    return cardStates.get(id) ?? { phase: "idle", error: null, draft: null };
  }

  function setCardState(id: string, nextState: WikiCommentCardState): void {
    cardStates.set(id, nextState);
  }

  function isActiveDocument(path: string, generation: number): boolean {
    return currentPath === path && documentGeneration === generation;
  }
}

function mergeCreatedComment(currentComments: WikiComment[], createdComment: WikiComment): WikiComment[] {
  if (currentComments.some((comment) => comment.id === createdComment.id)) {
    return currentComments;
  }
  return [createdComment, ...currentComments];
}

// fallow-ignore-next-line complexity
async function readApiResponse<T>(response: Response, fallbackMessage: string): Promise<ApiResponse<T>> {
  const contentType = response.headers?.get?.("content-type")?.toLowerCase() ?? "";
  if (contentType && !contentType.includes("application/json")) {
    const text = typeof response.text === "function" ? await response.text() : "";
    throw new Error(describeNonJsonResponse(text, fallbackMessage));
  }
  if (typeof response.json !== "function") {
    const text = typeof response.text === "function" ? await response.text() : "";
    throw new Error(describeNonJsonResponse(text, fallbackMessage));
  }
  try {
    return (await response.json()) as ApiResponse<T>;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("Unexpected token '<'") || message.includes("<!DOCTYPE") || message.includes("<html")) {
      throw new Error("评论服务暂时不可用，请重启 LLM Wiki WebUI 后再试。");
    }
    throw new Error(fallbackMessage);
  }
}

function describeNonJsonResponse(text: string, fallbackMessage: string): string {
  const normalized = text.trimStart().toLowerCase();
  if (normalized.startsWith("<!doctype") || normalized.startsWith("<html")) {
    return "评论服务暂时不可用，请重启 LLM Wiki WebUI 后再试。";
  }
  return fallbackMessage;
}

export function locateSelection(root: HTMLElement): WikiCommentSelection | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return null;
  }
  const range = selection.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) {
    return null;
  }
  const quote = selection.toString();
  if (!quote.trim()) {
    return null;
  }
  const leadingRange = range.cloneRange();
  leadingRange.selectNodeContents(root);
  leadingRange.setEnd(range.startContainer, range.startOffset);
  const start = leadingRange.toString().length;
  const end = start + quote.length;
  return { quote, start, end };
}

function applyHighlights(root: HTMLElement, comments: WikiComment[]): void {
  const ordered = [...comments].sort((a, b) => b.start - a.start);
  for (const comment of ordered) {
    wrapTextRange(root, comment);
  }
}

function wrapTextRange(root: HTMLElement, comment: WikiComment): void {
  const range = createTextRange(root, comment.start, comment.end);
  if (!range) {
    return;
  }
  const mark = document.createElement("mark");
  mark.className = "wiki-comments-panel__highlight";
  if (comment.resolved) {
    mark.classList.add("is-resolved");
  }
  mark.dataset.wikiCommentsHighlight = comment.id;
  try {
    const fragment = range.extractContents();
    mark.append(fragment);
    range.insertNode(mark);
  } catch {
    // ignore invalid ranges after content changes
  }
}

// fallow-ignore-next-line complexity
function createTextRange(root: HTMLElement, start: number, end: number): Range | null {
  const range = document.createRange();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let cursor = 0;
  let startNode: Text | null = null;
  let endNode: Text | null = null;
  let startOffset = 0;
  let endOffset = 0;
  let current = walker.nextNode();
  while (current) {
    const textNode = current as Text;
    const length = textNode.textContent?.length ?? 0;
    const nextCursor = cursor + length;
    if (!startNode && start >= cursor && start <= nextCursor) {
      startNode = textNode;
      startOffset = start - cursor;
    }
    if (!endNode && end >= cursor && end <= nextCursor) {
      endNode = textNode;
      endOffset = end - cursor;
      break;
    }
    cursor = nextCursor;
    current = walker.nextNode();
  }
  if (!startNode || !endNode) {
    return null;
  }
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);
  return range;
}

function cssEscape(value: string): string {
  const css = (window as Window & { CSS?: { escape?: (input: string) => string } }).CSS;
  if (typeof css?.escape === "function") {
    return css.escape(value);
  }
  return value.replace(/["\\]/g, "\\$&");
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (character) => {
    const escaped: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
    };
    return escaped[character] ?? character;
  });
}
