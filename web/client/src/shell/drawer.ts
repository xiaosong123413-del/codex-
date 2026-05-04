import { renderIcon } from "../components/icon.js";
import { createWikiCommentSurface } from "../components/wiki-comments.js";
import { handleKnowledgePreviewClick, withKnowledgePreviewLinks } from "./knowledge-preview-links.js";

interface DrawerContent {
  path: string;
  title: string;
  html: string;
  rawMarkdown?: string;
  aliases?: string[];
  sizeBytes?: number;
  modifiedAt?: string;
}

interface DrawerOptions {
  shellRoot: HTMLElement;
  container: HTMLElement;
  onNavigate: (path: string) => void;
}

export interface DrawerHandle {
  open(content: DrawerContent): void;
  close(): void;
  showLoading(path: string): void;
}

export function createDrawer(options: DrawerOptions): DrawerHandle {
  const { shellRoot, container, onNavigate } = options;
  let currentPath = "";

  container.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const closeButton = target.closest("[data-drawer-close]");
    if (closeButton) {
      event.preventDefault();
      close();
      return;
    }

    const copyButton = target.closest("[data-drawer-copy]");
    if (copyButton) {
      event.preventDefault();
      void copyWikilink(currentPath);
      return;
    }

    const crumb = target.closest("[data-drawer-crumb]") as HTMLButtonElement | null;
    if (crumb) {
      event.preventDefault();
      const nextPath = crumb.dataset.drawerCrumb;
      if (nextPath) {
        onNavigate(nextPath);
      }
      return;
    }

    handleKnowledgePreviewClick(event, onNavigate);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && shellRoot.dataset.drawerOpen === "true") {
      close();
    }
  });

  function show(content: DrawerContent): void {
    currentPath = content.path;
    shellRoot.dataset.drawerOpen = "true";
    container.className = "shell-drawer";
    container.innerHTML = `
      <div class="shell-drawer__header">
        <div class="shell-drawer__meta">
          <div class="eyebrow">Page</div>
          <div class="shell-drawer__breadcrumb">${renderBreadcrumb(content.path)}</div>
          <h2 class="shell-drawer__title">${escapeHtml(content.title)}</h2>
          <div class="shell-drawer__path">${escapeHtml(content.path)}</div>
        </div>
        <div class="shell-drawer__actions">
          <button type="button" class="icon-btn shell-drawer__action" data-drawer-copy aria-label="Copy wikilink">
            ${renderIcon("copy", { size: 16 })}
          </button>
          <button type="button" class="icon-btn shell-drawer__close" data-drawer-close aria-label="Close drawer">
            ${renderIcon("x", { size: 16 })}
          </button>
        </div>
      </div>
      <div class="shell-drawer__content">
        <div class="shell-drawer__article">
          <div class="shell-drawer__toolbar">
            <button type="button" class="btn btn-secondary btn-inline" data-wiki-comments-add>评论</button>
            <span class="shell-drawer__toolbar-status" data-wiki-comments-status>选中文本后点击评论。</span>
          </div>
          <div class="shell-drawer__body">${withKnowledgePreviewLinks(content.html)}</div>
        </div>
        <aside class="wiki-comments-panel shell-drawer__comments">
          <div class="wiki-comments-panel__header">
            <div>
              <div class="eyebrow">COMMENTS</div>
              <h3 class="wiki-comments-panel__title">评论</h3>
            </div>
            <button type="button" class="icon-btn shell-drawer__action" data-wiki-comments-close aria-label="Close comments">
              ${renderIcon("x", { size: 16 })}
            </button>
          </div>
          <p class="wiki-comments-panel__hint">这里显示当前 wiki 页面评论；和 wiki 页正文评论互通。</p>
          <div data-wiki-comments-list></div>
        </aside>
      </div>
      ${renderFooter(content)}
    `;
    const body = container.querySelector<HTMLElement>(".shell-drawer__body");
    const list = container.querySelector<HTMLElement>("[data-wiki-comments-list]");
    const status = container.querySelector<HTMLElement>("[data-wiki-comments-status]");
    const addButton = container.querySelector<HTMLButtonElement>("[data-wiki-comments-add]");
    const panel = container.querySelector<HTMLElement>(".shell-drawer__comments");
    const closeButton = container.querySelector<HTMLButtonElement>("[data-wiki-comments-close]");
    if (body && list && status && addButton && panel) {
      const commentSurface = createWikiCommentSurface({
        content: body,
        list,
        status,
        addButton,
        panel,
        closeButton: closeButton ?? undefined,
        emptyLabel: "当前页面还没有评论。",
      });
      void commentSurface.setDocument(content.path, content.html);
    }
  }

  function close(): void {
    currentPath = "";
    shellRoot.dataset.drawerOpen = "false";
    container.className = "";
    container.innerHTML = "";
  }

  return {
    open(content) {
      show(content);
    },
    close,
    showLoading(path) {
      show({
        path,
        title: "Loading...",
        html: '<p class="loading">Loading page</p>',
      });
    },
  };
}

function renderBreadcrumb(path: string): string {
  const segments = path.split("/").filter(Boolean);
  return segments
    .map((segment, index) => {
      const segmentPath = segments.slice(0, index + 1).join("/");
      return `
        <button type="button" class="shell-drawer__crumb" data-drawer-crumb="${escapeHtml(segmentPath)}">
          ${escapeHtml(segment)}
        </button>
      `;
    })
    .join('<span class="shell-drawer__crumb-sep">/</span>');
}

function renderFooter(content: DrawerContent): string {
  const meta = [
    typeof content.sizeBytes === "number" ? formatBytes(content.sizeBytes) : "",
    content.modifiedAt ? formatDate(content.modifiedAt) : "",
  ].filter(Boolean);

  const aliasHtml = (content.aliases ?? [])
    .map((alias) => `<span class="shell-drawer__alias">${escapeHtml(alias)}</span>`)
    .join("");

  if (meta.length === 0 && aliasHtml.length === 0) {
    return "";
  }

  return `
    <div class="shell-drawer__footer">
      <div class="shell-drawer__meta-row">${meta.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div>
      ${aliasHtml ? `<div class="shell-drawer__aliases">${aliasHtml}</div>` : ""}
    </div>
  `;
}

async function copyWikilink(path: string): Promise<void> {
  if (!path || !navigator.clipboard?.writeText) {
    return;
  }
  await navigator.clipboard.writeText(`[[${path}]]`);
}

function formatBytes(sizeBytes: number): string {
  if (sizeBytes < 1024) {
    return `${sizeBytes} B`;
  }
  if (sizeBytes < 1024 * 1024) {
    return `${(sizeBytes / 1024).toFixed(1)} KB`;
  }
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toISOString().slice(0, 10);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
