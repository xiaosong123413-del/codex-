/**
 * Shared knowledge preview link helpers.
 *
 * The shell uses these helpers to mark wiki knowledge links with one
 * data attribute and to intercept clicks before page-level routers can turn
 * those links into full navigation. Chat citations, drawer wikilinks, and
 * work-log knowledge links should all enter the same right-side preview path.
 */

const KNOWLEDGE_PREVIEW_LINK_SELECTOR = [
  "[data-knowledge-preview-path]",
  "a.wikilink",
  "a[href^='#/wiki/']",
  "a[href*='?page=']",
].join(",");

interface KnowledgePreviewDataAttributes {
  path: string;
  index?: number;
}

/**
 * Builds the canonical wiki route href for a previewable knowledge path.
 */
export function knowledgePreviewHref(path: string): string {
  return `#/wiki/${encodeURIComponent(normalizeKnowledgePreviewPath(path))}`;
}

/**
 * Renders the shared data attributes used by previewable knowledge links.
 */
export function renderKnowledgePreviewDataAttributes(attributes: KnowledgePreviewDataAttributes): string {
  const pathAttribute = `data-knowledge-preview-path="${escapeAttribute(attributes.path)}"`;
  if (typeof attributes.index !== "number") {
    return pathAttribute;
  }
  return `${pathAttribute} data-knowledge-preview-index="${attributes.index}"`;
}

/**
 * Adds shared preview data attributes to rendered wiki links without changing
 * their visible text or href.
 */
export function withKnowledgePreviewLinks(html: string): string {
  if (!html.includes("<a")) {
    return html;
  }
  const wrapper = document.createElement("div");
  wrapper.innerHTML = html;
  wrapper.querySelectorAll<HTMLAnchorElement>(KNOWLEDGE_PREVIEW_LINK_SELECTOR).forEach((link) => {
    const path = readKnowledgePreviewPathFromLink(link);
    if (path) {
      link.setAttribute("data-knowledge-preview-path", path);
    }
  });
  return wrapper.innerHTML;
}

/**
 * Captures a knowledge-link click and delegates it to the preview opener.
 */
export function handleKnowledgePreviewClick(
  event: MouseEvent,
  onOpenPreview: ((path: string) => void) | undefined,
): boolean {
  if (!onOpenPreview) {
    return false;
  }
  const path = readKnowledgePreviewPathFromEvent(event);
  if (!path) {
    return false;
  }
  event.preventDefault();
  event.stopPropagation();
  onOpenPreview(path);
  return true;
}

function readKnowledgePreviewPathFromEvent(event: MouseEvent): string | null {
  const target = event.target;
  if (!(target instanceof Element)) {
    return null;
  }
  const link = target.closest<HTMLElement>(KNOWLEDGE_PREVIEW_LINK_SELECTOR);
  if (!link) {
    return null;
  }
  return readKnowledgePreviewPathFromElement(link);
}

function readKnowledgePreviewPathFromElement(element: HTMLElement): string | null {
  const dataPath = element.getAttribute("data-knowledge-preview-path");
  if (dataPath) {
    return normalizeKnowledgePreviewPath(dataPath);
  }
  if (element instanceof HTMLAnchorElement) {
    return readKnowledgePreviewPathFromLink(element);
  }
  return null;
}

function readKnowledgePreviewPathFromLink(link: HTMLAnchorElement): string | null {
  const dataPath = link.getAttribute("data-knowledge-preview-path");
  if (dataPath) {
    return normalizeKnowledgePreviewPath(dataPath);
  }
  return readKnowledgePreviewPathFromHref(link.getAttribute("href") ?? "");
}

function readKnowledgePreviewPathFromHref(href: string): string | null {
  if (href.startsWith("#/wiki/")) {
    return normalizeKnowledgePreviewPath(decodeHashWikiPath(href));
  }
  try {
    const url = new URL(href, window.location.origin);
    const page = url.searchParams.get("page");
    return page ? normalizeKnowledgePreviewPath(page) : null;
  } catch {
    return null;
  }
}

function decodeHashWikiPath(href: string): string {
  const path = href.slice("#/wiki/".length).split("#", 1)[0] ?? "";
  return decodeURIComponent(path);
}

function normalizeKnowledgePreviewPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+/, "").trim();
}

function escapeAttribute(value: string): string {
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
