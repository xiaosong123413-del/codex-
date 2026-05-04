/**
 * Deposit-library renderer for the workspace work-log page.
 *
 * Case records live in their own library page. The deposit library keeps only
 * reusable methods and tools, grouped by validation status with editable cards.
 */
import { withKnowledgePreviewLinks } from "../../shell/knowledge-preview-links.js";

export type WorkspaceGalleryStatus = "已验证但成功" | "待验证" | "已验证但失败";
type WorkspaceGalleryType = "case" | "method" | "tool";

export interface WorkspaceDocGalleryMeta {
  type: WorkspaceGalleryType;
  status: WorkspaceGalleryStatus | null;
}

interface WorkspaceLibraryDocument {
  id: string;
  kind: string;
  label: string;
  path: string;
  title: string | null;
  html: string;
  raw: string;
  contentLoaded?: boolean;
  gallery?: WorkspaceDocGalleryMeta;
}

const WORKSPACE_GALLERY_STATUSES: readonly WorkspaceGalleryStatus[] = [
  "已验证但成功",
  "待验证",
  "已验证但失败",
];

const DEPOSIT_LIBRARY_ID = "domain:02-沉淀库";
const DEPOSIT_LIBRARY_PATH = "wiki/专题/02-沉淀库/index.md";
const LIBRARY_TYPES: readonly WorkspaceGalleryType[] = ["method", "tool"];
const LIBRARY_LABELS: Record<WorkspaceGalleryType, string> = {
  case: "案例库",
  method: "方法库",
  tool: "工具箱",
};

/**
 * Returns whether this document should use the unified library renderer.
 */
export function isWorkspaceLibraryPage(document: WorkspaceLibraryDocument): boolean {
  return document.id === DEPOSIT_LIBRARY_ID || document.path === DEPOSIT_LIBRARY_PATH;
}

/**
 * Renders case, method, and tool libraries as one editable workspace page.
 */
export function renderWorkspaceLibraryDocument(
  container: WorkspaceLibraryDocument,
  documents: readonly WorkspaceLibraryDocument[],
  selectedPath: string | null,
): string {
  const items = collectAllLibraryItems(documents);
  const selected = selectWorkspaceGalleryItem(items, selectedPath);
  return `
    <section class="workspace-log-wiki-entry workspace-library-gallery" data-workspace-library-gallery>
      <main class="workspace-library-gallery__main">
        <header class="workspace-library-gallery__header">
          <div>
            <h1>${escapeHtml(readWorkspaceLibraryTitle(container))}</h1>
            <p>方法和工具统一沉淀，按验证状态维护。</p>
          </div>
        </header>
        <div class="workspace-library-gallery__layout">
          <section class="workspace-library-gallery__sections" aria-label="沉淀库">
            ${LIBRARY_TYPES.map((type) => renderLibrarySection(type, documents, selected?.path ?? "")).join("")}
          </section>
          ${renderWorkspaceGalleryDetail(selected)}
        </div>
      </main>
    </section>
  `;
}

function renderLibrarySection(
  type: WorkspaceGalleryType,
  documents: readonly WorkspaceLibraryDocument[],
  selectedPath: string,
): string {
  const items = collectLibraryItems(type, documents);
  return `
    <section class="workspace-library-section" data-workspace-library-kind="${type}">
      <header class="workspace-library-section__header">
        <span>${escapeHtml(LIBRARY_LABELS[type])}</span>
        <strong>${items.length}</strong>
      </header>
      ${renderStatusBoard(items, selectedPath)}
    </section>
  `;
}

function renderStatusBoard(items: readonly WorkspaceLibraryDocument[], selectedPath: string): string {
  return `
    <div class="workspace-library-gallery__board">
      ${WORKSPACE_GALLERY_STATUSES.map((status) => renderWorkspaceGalleryColumn(status, items, selectedPath)).join("")}
    </div>
  `;
}

function renderWorkspaceGalleryColumn(
  status: WorkspaceGalleryStatus,
  items: readonly WorkspaceLibraryDocument[],
  selectedPath: string,
): string {
  const statusItems = items.filter((item) => item.gallery?.status === status);
  return `
    <section class="workspace-library-gallery__column" data-workspace-gallery-drop-status="${escapeHtml(status)}">
      <header><span>${escapeHtml(status)}</span><strong>${statusItems.length}</strong></header>
      <div class="workspace-library-gallery__cards">
        ${statusItems.map((item) => renderWorkspaceGalleryCard(item, selectedPath)).join("") || renderWorkspaceGalleryEmptyCard()}
      </div>
    </section>
  `;
}

function renderWorkspaceGalleryCard(item: WorkspaceLibraryDocument, selectedPath: string): string {
  const isActive = item.path === selectedPath;
  return `
    <button
      type="button"
      class="workspace-library-card${isActive ? " is-active" : ""}"
      data-workspace-gallery-card="${escapeHtml(item.path)}"
      data-workspace-gallery-card-status="${escapeHtml(item.gallery?.status ?? "")}"
      draggable="true"
    >
      <strong>${escapeHtml(item.title ?? item.label)}</strong>
      <span>${escapeHtml(readWorkspaceGallerySummary(item))}</span>
    </button>
  `;
}

function renderWorkspaceGalleryDetail(item: WorkspaceLibraryDocument | null): string {
  if (!item) {
    return `<aside class="workspace-library-detail"><div class="workspace-library-detail__empty">选择左侧卡片查看详情。</div></aside>`;
  }
  if (item.contentLoaded !== true) {
    return `<aside class="workspace-library-detail"><div class="workspace-library-detail__empty">正在读取详情...</div></aside>`;
  }
  return renderLoadedWorkspaceGalleryDetail(item);
}

function renderLoadedWorkspaceGalleryDetail(item: WorkspaceLibraryDocument): string {
  const title = item.title ?? item.label;
  const html = withKnowledgePreviewLinks(ensureWorkspaceDocumentTitle(item.html, title) || renderWorkspaceWikiEmptyState(title));
  return `
    <aside class="workspace-library-detail">
      <header class="workspace-library-detail__header">
        <div>
          <span>${escapeHtml(readWorkspaceDetailLabel(item))}</span>
          <h2>${escapeHtml(title)}</h2>
        </div>
        <button type="button" class="workspace-library-detail__save" data-workspace-gallery-save>保存</button>
      </header>
      <article class="markdown-rendered workspace-library-detail__editor" contenteditable="true" spellcheck="false" data-workspace-gallery-editor="${escapeHtml(item.path)}">${html}</article>
    </aside>
  `;
}

function collectAllLibraryItems(documents: readonly WorkspaceLibraryDocument[]): WorkspaceLibraryDocument[] {
  return LIBRARY_TYPES.flatMap((type) => collectLibraryItems(type, documents));
}

function collectLibraryItems(
  type: WorkspaceGalleryType,
  documents: readonly WorkspaceLibraryDocument[],
): WorkspaceLibraryDocument[] {
  return documents.filter((item) =>
    item.kind !== "project" &&
    item.gallery?.type === type &&
    (type === "case" || item.gallery.status !== null),
  );
}

function selectWorkspaceGalleryItem(
  items: readonly WorkspaceLibraryDocument[],
  selectedPath: string | null,
): WorkspaceLibraryDocument | null {
  return items.find((item) => item.path === selectedPath) ?? items[0] ?? null;
}

function readWorkspaceLibraryTitle(document: WorkspaceLibraryDocument): string {
  return document.gallery?.type ? "方法库 / 工具箱" : document.title ?? document.label;
}

function readWorkspaceDetailLabel(document: WorkspaceLibraryDocument): string {
  return document.gallery?.status ?? LIBRARY_LABELS[document.gallery?.type ?? "case"];
}

function readWorkspaceGallerySummary(document: WorkspaceLibraryDocument): string {
  const text = (document.raw.trim() || readPlainTextFromHtml(document.html))
    .split(/\r?\n/)
    .map((line) => line.replace(/^#+\s*/u, "").trim())
    .find((line) => line.length > 0 && !line.includes("：")) ?? "";
  return text || document.path;
}

function ensureWorkspaceDocumentTitle(html: string, title: string): string {
  const trimmed = html.trim();
  if (!trimmed) return "";
  const wrapper = document.createElement("div");
  wrapper.innerHTML = trimmed;
  if (wrapper.querySelector("h1, h2, h3")) return wrapper.innerHTML;
  const titleNode = document.createElement("h1");
  titleNode.textContent = title;
  wrapper.prepend(titleNode);
  return wrapper.innerHTML;
}

function readPlainTextFromHtml(html: string): string {
  const wrapper = document.createElement("div");
  wrapper.innerHTML = html;
  return wrapper.textContent?.trim() ?? "";
}

function renderWorkspaceGalleryEmptyCard(): string {
  return `<div class="workspace-library-card workspace-library-card--empty">暂无条目</div>`;
}

function renderWorkspaceWikiEmptyState(title: string): string {
  return `<h1>${escapeHtml(title)}</h1><p>暂无内容。</p>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (character) => {
    const escaped: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" };
    return escaped[character] ?? character;
  });
}
