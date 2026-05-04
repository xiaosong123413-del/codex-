import {
  applyPanelWidth,
  clampPanelWidth,
  readPanelWidth,
  writePanelWidth,
  type PanelWidthBounds,
} from "../../shell/panel-layout.js";
import { attachResizeHandle } from "../../shell/resize-handle.js";

interface ProjectLogResponse {
  success: boolean;
  data?: {
    path: string;
    html: string;
    raw: string;
    modifiedAt: string | null;
  };
  error?: string;
}

interface ProjectLogComment {
  id: string;
  quote: string;
  text: string;
  resolved: boolean;
}

type CommentFilter = "all" | "open" | "resolved";

const PROJECT_LOG_COMMENTS_BOUNDS: PanelWidthBounds = {
  defaultWidth: 380,
  minWidth: 280,
  maxWidth: 560,
};

const PROJECT_LOG_TOC_BOUNDS: PanelWidthBounds = {
  defaultWidth: 320,
  minWidth: 240,
  maxWidth: 480,
};

export function renderProjectLogPage(): HTMLElement {
  const root = document.createElement("section") as HTMLElement & { __dispose?: () => void };
  root.className = "project-log-page";
  root.innerHTML = `
    <div class="project-log-page__toolbar" data-project-log-toolbar>
      <button type="button" class="btn btn-secondary btn-inline" data-project-log-toc-toggle>\u76ee\u5f55</button>
      <span class="project-log-page__toolbar-separator"></span>
      <button type="button" class="btn btn-secondary btn-inline is-active" data-project-log-filter="all">\u5168\u90e8\u8bc4\u8bba</button>
      <button type="button" class="btn btn-secondary btn-inline" data-project-log-filter="open">\u672a\u89e3\u51b3</button>
      <button type="button" class="btn btn-secondary btn-inline" data-project-log-filter="resolved">\u5df2\u89e3\u51b3</button>
      <span class="project-log-page__toolbar-status" data-project-log-comment-status>\u9009\u4e2d\u6587\u5b57\u540e\uff0c\u53ef\u5728\u9009\u533a\u65c1\u70b9\u51fb\u8bc4\u8bba\u3002</span>
    </div>
    <div class="project-log-page__hero">
      <div>
        <div class="eyebrow">PROJECT MEMORY</div>
        <h1 class="project-log-page__title">\u9879\u76ee\u65e5\u5fd7</h1>
        <p>\u8bb0\u5f55 LLM Wiki \u5e94\u7528\u7684\u5f53\u524d\u754c\u9762\u3001\u5f53\u524d\u6d41\u7a0b\u548c\u53ea\u8ffd\u52a0\u7684\u4fee\u6539\u65f6\u95f4\u7ebf\u3002</p>
      </div>
      <div class="project-log-page__meta" data-project-log-meta>\u8bfb\u53d6\u4e2d</div>
    </div>
    <article class="project-log-page__document markdown-body" data-project-log-content>
      <p>\u6b63\u5728\u8bfb\u53d6\u9879\u76ee\u65e5\u5fd7...</p>
    </article>
    <aside class="project-log-page__toc" data-project-log-toc-panel hidden>
      <div class="project-log-page__toc-resize panel-resize-handle" data-project-log-toc-resize></div>
      <div class="project-log-page__side-card">
        <div class="project-log-page__side-card-header">
          <div>
            <div class="eyebrow">CONTENTS</div>
            <h2>\u76ee\u5f55</h2>
          </div>
          <button type="button" class="icon-btn project-log-page__side-close" aria-label="\u5173\u95ed\u76ee\u5f55" data-project-log-close="toc">\u00d7</button>
        </div>
        <nav data-project-log-toc-list></nav>
      </div>
    </aside>
    <aside class="project-log-page__comments" data-project-log-comments-panel hidden>
      <div class="project-log-page__comments-resize panel-resize-handle" data-project-log-comments-resize></div>
      <div class="project-log-page__side-card">
        <div class="project-log-page__side-card-header">
          <div>
            <div class="eyebrow">COMMENTS</div>
            <h2>\u8bc4\u8bba</h2>
          </div>
          <button type="button" class="icon-btn project-log-page__side-close" aria-label="\u5173\u95ed\u8bc4\u8bba\u680f" data-project-log-close="comments">\u00d7</button>
        </div>
        <p class="project-log-page__comments-hint">\u9009\u4e2d\u6587\u5b57\u540e\u6dfb\u52a0\u8bc4\u8bba\uff0c\u53ef\u7f16\u8f91\u3001\u5220\u9664\u6216\u6807\u8bb0\u89e3\u51b3\u3002</p>
        <div data-project-log-comments-list></div>
      </div>
    </aside>
    <button type="button" class="btn btn-primary btn-inline project-log-page__selection-comment" data-project-log-selection-comment hidden>\u8bc4\u8bba</button>
  `;

  root.__dispose = bindProjectLogTools(root);
  void loadProjectLog(root);
  return root;
}

async function loadProjectLog(root: HTMLElement): Promise<void> {
  const content = root.querySelector<HTMLElement>("[data-project-log-content]")!;
  const meta = root.querySelector<HTMLElement>("[data-project-log-meta]")!;

  try {
    const response = await fetch("/api/project-log");
    const payload = (await response.json()) as ProjectLogResponse;
    if (!response.ok || !payload.success || !payload.data) {
      throw new Error(payload.error ?? "project log load failed");
    }

    content.innerHTML = payload.data.html;
    meta.textContent = `${payload.data.path}${payload.data.modifiedAt ? ` \u00b7 ${formatTime(payload.data.modifiedAt)}` : ""}`;
    renderTableOfContents(root);
  } catch (error) {
    content.innerHTML = `<p class="project-log-page__error">${escapeHtml(error instanceof Error ? error.message : String(error))}</p>`;
    meta.textContent = "\u8bfb\u53d6\u5931\u8d25";
  }
}

function bindProjectLogTools(root: HTMLElement): () => void {
  const comments: ProjectLogComment[] = [];
  let filter: CommentFilter = "all";
  let commentsWidth = readPanelWidth("projectLog.commentsWidth", PROJECT_LOG_COMMENTS_BOUNDS);
  let tocWidth = readPanelWidth("projectLog.tocWidth", PROJECT_LOG_TOC_BOUNDS);
  let pendingSelectionRange: Range | null = null;

  const tocPanel = root.querySelector<HTMLElement>("[data-project-log-toc-panel]")!;
  const tocResize = root.querySelector<HTMLElement>("[data-project-log-toc-resize]")!;
  const commentsPanel = root.querySelector<HTMLElement>("[data-project-log-comments-panel]")!;
  const commentsResize = root.querySelector<HTMLElement>("[data-project-log-comments-resize]")!;
  const selectionCommentButton = root.querySelector<HTMLButtonElement>("[data-project-log-selection-comment]")!;
  const status = root.querySelector<HTMLElement>("[data-project-log-comment-status]")!;

  applyPanelWidth(root, "--project-log-comments-width", commentsWidth);
  applyPanelWidth(root, "--project-log-toc-width", tocWidth);

  root.querySelector<HTMLButtonElement>("[data-project-log-toc-toggle]")!.addEventListener("click", () => {
    tocPanel.hidden = !tocPanel.hidden;
    root.classList.toggle("project-log-page--toc-open", !tocPanel.hidden);
  });
  root.querySelector<HTMLButtonElement>("[data-project-log-close='toc']")?.addEventListener("click", () => {
    tocPanel.hidden = true;
    root.classList.remove("project-log-page--toc-open");
  });

  const setCommentsVisible = (visible: boolean): void => {
    commentsPanel.hidden = !visible;
    root.classList.toggle("project-log-page--comments-open", visible);
  };
  const hideSelectionCommentButton = (): void => {
    selectionCommentButton.hidden = true;
    pendingSelectionRange = null;
  };
  const syncSelectionCommentButton = (): void => {
    if (!root.isConnected) {
      document.removeEventListener("selectionchange", syncSelectionCommentButton);
      return;
    }
    const range = getCommentableSelectionRange(root);
    if (!range) {
      hideSelectionCommentButton();
      return;
    }
    pendingSelectionRange = range.cloneRange();
    positionSelectionCommentButton(root, selectionCommentButton, pendingSelectionRange);
    selectionCommentButton.hidden = false;
    status.textContent = "\u9009\u4e2d\u6587\u5b57\u540e\uff0c\u53ef\u5728\u9009\u533a\u65c1\u70b9\u51fb\u8bc4\u8bba\u3002";
  };
  root.querySelector<HTMLButtonElement>("[data-project-log-close='comments']")?.addEventListener("click", () => {
    setCommentsVisible(false);
  });

  selectionCommentButton.addEventListener("mousedown", (event) => {
    event.preventDefault();
  });
  selectionCommentButton.addEventListener("click", () => {
    const comment = createCommentFromRange(root, pendingSelectionRange);
    if (!comment) {
      status.textContent = "\u9700\u8981\u5148\u9009\u4e2d\u9879\u76ee\u65e5\u5fd7\u6b63\u6587\u91cc\u7684\u6587\u5b57\u3002";
      hideSelectionCommentButton();
      return;
    }
    comments.unshift(comment);
    setCommentsVisible(true);
    status.textContent = "\u5df2\u6807\u8bb0\u9009\u4e2d\u6587\u5b57\uff0c\u8bf7\u5728\u53f3\u4fa7\u586b\u5199\u8bc4\u8bba\u3002";
    renderComments(root, comments, filter);
    root.querySelector<HTMLTextAreaElement>("[data-project-log-comment-input]")?.focus();
    hideSelectionCommentButton();
  });

  root.querySelectorAll<HTMLButtonElement>("[data-project-log-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      filter = normalizeFilter(button.dataset.projectLogFilter);
      root.querySelectorAll<HTMLButtonElement>("[data-project-log-filter]").forEach((item) => {
        item.classList.toggle("is-active", item === button);
      });
      setCommentsVisible(true);
      renderComments(root, comments, filter);
    });
  });

  attachResizeHandle({
    handle: tocResize,
    onMove(event) {
      tocWidth = clampPanelWidth(window.innerWidth - 24 - event.clientX, PROJECT_LOG_TOC_BOUNDS);
      applyPanelWidth(root, "--project-log-toc-width", tocWidth);
    },
    onEnd() {
      tocWidth = writePanelWidth("projectLog.tocWidth", tocWidth, PROJECT_LOG_TOC_BOUNDS);
      applyPanelWidth(root, "--project-log-toc-width", tocWidth);
    },
  });

  attachResizeHandle({
    handle: commentsResize,
    onMove(event) {
      commentsWidth = clampPanelWidth(window.innerWidth - 24 - event.clientX, PROJECT_LOG_COMMENTS_BOUNDS);
      applyPanelWidth(root, "--project-log-comments-width", commentsWidth);
    },
    onEnd() {
      commentsWidth = writePanelWidth("projectLog.commentsWidth", commentsWidth, PROJECT_LOG_COMMENTS_BOUNDS);
      applyPanelWidth(root, "--project-log-comments-width", commentsWidth);
    },
  });

  document.addEventListener("selectionchange", syncSelectionCommentButton);
  root.addEventListener("scroll", () => {
    hideSelectionCommentButton();
  }, { passive: true });
  root.addEventListener("click", (event) => {
    const clickTarget = event.target as HTMLElement;
    if (shouldHideProjectLogSelectionCommentButton(clickTarget)) {
      hideSelectionCommentButton();
    }
    handleProjectLogCommentCardClick(root, clickTarget, comments, filter);
  });

  return () => {
    document.removeEventListener("selectionchange", syncSelectionCommentButton);
  };
}

function shouldHideProjectLogSelectionCommentButton(clickTarget: HTMLElement): boolean {
  return !clickTarget.closest("[data-project-log-selection-comment]")
    && !clickTarget.closest("[data-project-log-content]");
}

function handleProjectLogCommentCardClick(
  root: HTMLElement,
  clickTarget: HTMLElement,
  comments: ProjectLogComment[],
  filter: CommentFilter,
): void {
  const card = clickTarget.closest<HTMLElement>("[data-project-log-comment-card]");
  if (!card) {
    return;
  }

  const id = card.dataset.projectLogCommentCard ?? "";
  const comment = comments.find((item) => item.id === id);
  if (clickTarget.closest("[data-project-log-comment-save]")) {
    saveProjectLogComment(card, comment, root, comments, filter);
    return;
  }
  if (clickTarget.closest("[data-project-log-comment-resolve]")) {
    toggleProjectLogCommentResolved(id, comment, root, comments, filter);
    return;
  }
  if (clickTarget.closest("[data-project-log-comment-delete]")) {
    deleteProjectLogComment(card, id, root, comments, filter);
  }
}

function saveProjectLogComment(
  card: HTMLElement,
  comment: ProjectLogComment | undefined,
  root: HTMLElement,
  comments: ProjectLogComment[],
  filter: CommentFilter,
): void {
  if (!comment) {
    return;
  }
  comment.text = card.querySelector<HTMLTextAreaElement>("[data-project-log-comment-input]")?.value ?? "";
  renderComments(root, comments, filter);
}

function toggleProjectLogCommentResolved(
  id: string,
  comment: ProjectLogComment | undefined,
  root: HTMLElement,
  comments: ProjectLogComment[],
  filter: CommentFilter,
): void {
  if (!comment) {
    return;
  }
  comment.resolved = !comment.resolved;
  const marker = root.querySelector<HTMLElement>(`[data-project-log-comment-highlight="${cssEscape(id)}"]`);
  marker?.classList.toggle("is-resolved", comment.resolved);
  renderComments(root, comments, filter);
}

function deleteProjectLogComment(
  card: HTMLElement,
  id: string,
  root: HTMLElement,
  comments: ProjectLogComment[],
  filter: CommentFilter,
): void {
  const index = comments.findIndex((item) => item.id === id);
  if (index >= 0) {
    comments.splice(index, 1);
  }
  const marker = root.querySelector<HTMLElement>(`[data-project-log-comment-highlight="${cssEscape(id)}"]`);
  if (marker) {
    marker.replaceWith(document.createTextNode(marker.textContent ?? ""));
  }
  card.remove();
  renderComments(root, comments, filter);
}

function createCommentFromRange(root: HTMLElement, range: Range | null): ProjectLogComment | null {
  const content = root.querySelector<HTMLElement>("[data-project-log-content]")!;
  const selection = window.getSelection();
  if (!range) {
    return null;
  }
  if (!content.contains(range.commonAncestorContainer)) {
    return null;
  }

  const quote = range.toString().trim();
  if (quote.length === 0) {
    return null;
  }
  const id = `comment-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const marker = document.createElement("mark");
  marker.className = "project-log-page__comment-highlight";
  marker.dataset.projectLogCommentHighlight = id;
  marker.textContent = quote;
  range.deleteContents();
  range.insertNode(marker);
  selection.removeAllRanges();

  return { id, quote, text: "", resolved: false };
}

function getCommentableSelectionRange(root: HTMLElement): Range | null {
  const content = root.querySelector<HTMLElement>("[data-project-log-content]")!;
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.toString().trim().length === 0) {
    return null;
  }
  const range = selection.getRangeAt(0);
  if (!content.contains(range.commonAncestorContainer)) {
    return null;
  }
  return range;
}

function positionSelectionCommentButton(root: HTMLElement, button: HTMLButtonElement, range: Range): void {
  button.hidden = false;
  const content = root.querySelector<HTMLElement>("[data-project-log-content]")!;
  const rect = getSelectionClientRect(range) ?? content.getBoundingClientRect();
  const gutter = 12;
  const buttonRect = button.getBoundingClientRect();
  const buttonWidth = buttonRect.width || 72;
  const buttonHeight = buttonRect.height || 36;
  const viewportWidth = readProjectLogViewportSize(window.innerWidth, document.documentElement.clientWidth, 1280);
  const viewportHeight = readProjectLogViewportSize(window.innerHeight, document.documentElement.clientHeight, 720);
  const left = resolveProjectLogSelectionButtonLeft(rect, buttonWidth, viewportWidth, gutter);
  const top = resolveProjectLogSelectionButtonTop(rect, buttonHeight, viewportHeight, gutter);
  button.style.left = `${Math.round(left)}px`;
  button.style.top = `${Math.round(top)}px`;
}

function readProjectLogViewportSize(primary: number, secondary: number, fallback: number): number {
  return primary || secondary || fallback;
}

function resolveProjectLogSelectionButtonLeft(
  rect: DOMRect,
  buttonWidth: number,
  viewportWidth: number,
  gutter: number,
): number {
  let left = rect.right + gutter;
  if (left + buttonWidth + gutter > viewportWidth) {
    left = rect.left - buttonWidth - gutter;
  }
  return Math.max(gutter, Math.min(left, viewportWidth - buttonWidth - gutter));
}

function resolveProjectLogSelectionButtonTop(
  rect: DOMRect,
  buttonHeight: number,
  viewportHeight: number,
  gutter: number,
): number {
  let top = rect.top - buttonHeight - 8;
  if (top < gutter) {
    top = rect.bottom + 8;
  }
  return Math.max(gutter, Math.min(top, viewportHeight - buttonHeight - gutter));
}

function readFirstVisibleRangeRect(range: Range): DOMRect | null {
  const rects = typeof range.getClientRects === "function" ? Array.from(range.getClientRects()) : [];
  return rects.find((rect) => rect.width > 0 || rect.height > 0) ?? null;
}

function readBoundingRangeRect(range: Range): DOMRect | null {
  if (typeof range.getBoundingClientRect !== "function") {
    return null;
  }
  const rect = range.getBoundingClientRect();
  if (rect.width > 0 || rect.height > 0) {
    return rect;
  }
  if (rect.top !== 0 || rect.left !== 0 || rect.bottom !== 0 || rect.right !== 0) {
    return rect;
  }
  return null;
}

function readFallbackRangeRect(range: Range): DOMRect | null {
  const fallbackNode = range.startContainer instanceof Element
    ? range.startContainer
    : range.startContainer.parentElement;
  return fallbackNode?.getBoundingClientRect() ?? null;
}

function getSelectionClientRect(range: Range): DOMRect | null {
  const firstRect = readFirstVisibleRangeRect(range);
  if (firstRect) {
    return firstRect;
  }
  return readBoundingRangeRect(range) ?? readFallbackRangeRect(range);
}

function renderComments(root: HTMLElement, comments: ProjectLogComment[], filter: CommentFilter): void {
  const list = root.querySelector<HTMLElement>("[data-project-log-comments-list]")!;
  const visible = comments.filter((comment) => {
    if (filter === "open") return !comment.resolved;
    if (filter === "resolved") return comment.resolved;
    return true;
  });

  if (visible.length === 0) {
    list.innerHTML = `<p class="project-log-page__comments-empty">\u5f53\u524d\u7b5b\u9009\u4e0b\u6ca1\u6709\u8bc4\u8bba\u3002</p>`;
    return;
  }

  list.innerHTML = visible.map((comment) => `
    <article class="project-log-page__comment-card" data-project-log-comment-card="${escapeHtml(comment.id)}">
      <blockquote>${escapeHtml(comment.quote)}</blockquote>
      <textarea data-project-log-comment-input>${escapeHtml(comment.text)}</textarea>
      <div class="project-log-page__comment-actions">
        <button type="button" class="btn btn-secondary btn-inline" data-project-log-comment-save>\u4fdd\u5b58</button>
        <button type="button" class="btn btn-secondary btn-inline" data-project-log-comment-resolve>${comment.resolved ? "\u91cd\u65b0\u6253\u5f00" : "\u89e3\u51b3"}</button>
        <button type="button" class="btn btn-secondary btn-inline" data-project-log-comment-delete>\u5220\u9664</button>
      </div>
    </article>
  `).join("");

  list.querySelectorAll<HTMLButtonElement>("[data-project-log-comment-delete]").forEach((button) => {
    button.addEventListener("click", () => {
      const card = button.closest<HTMLElement>("[data-project-log-comment-card]");
      const id = card?.dataset.projectLogCommentCard ?? "";
      const index = comments.findIndex((item) => item.id === id);
      if (index >= 0) comments.splice(index, 1);
      const marker = root.querySelector<HTMLElement>(`[data-project-log-comment-highlight="${cssEscape(id)}"]`);
      if (marker) marker.replaceWith(document.createTextNode(marker.textContent ?? ""));
      renderComments(root, comments, filter);
    });
  });
}

function renderTableOfContents(root: HTMLElement): void {
  const content = root.querySelector<HTMLElement>("[data-project-log-content]")!;
  const list = root.querySelector<HTMLElement>("[data-project-log-toc-list]")!;
  const headings = Array.from(content.querySelectorAll<HTMLHeadingElement>("h1,h2,h3,h4"));
  list.innerHTML = headings.map((heading, index) => {
    const level = Number(heading.tagName.slice(1));
    const id = heading.id || `project-log-heading-${index}`;
    heading.id = id;
    return `
      <button
        type="button"
        class="project-log-page__toc-link project-log-page__toc-link--level-${level}"
        data-project-log-heading-target="${escapeHtml(id)}"
      >${escapeHtml(heading.textContent ?? "")}</button>
    `;
  }).join("");
  list.querySelectorAll<HTMLButtonElement>("[data-project-log-heading-target]").forEach((button) => {
    button.addEventListener("click", () => {
      const targetId = button.dataset.projectLogHeadingTarget;
      if (!targetId) return;
      const target = content.querySelector<HTMLElement>(`#${cssEscape(targetId)}`);
      target?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
}

function normalizeFilter(value: string | undefined): CommentFilter {
  return value === "open" || value === "resolved" ? value : "all";
}

function cssEscape(value: string): string {
  const css = (window as Window & { CSS?: { escape?: (input: string) => string } }).CSS;
  if (typeof css?.escape === "function") {
    return css.escape(value);
  }
  return value.replace(/["\\]/g, "\\$&");
}

function formatTime(value: string): string {
  return new Date(value).toLocaleString();
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (character) => {
    const escaped: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
    };
    return escaped[character] ?? character;
  });
}
