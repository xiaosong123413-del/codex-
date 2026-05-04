/**
 * Hover preview controller for rendered wiki double-links.
 *
 * The controller listens on the wiki page root, prefetches linked pages on
 * hover, then renders a fixed-size preview card after a short dwell.
 */

interface WikiLinkPreviewPage {
  path: string;
  title: string | null;
  html: string;
  frontmatter: Record<string, unknown> | null;
}

interface WikiLinkPreviewController {
  dispose(): void;
  hide(): void;
}

const HOVER_DELAY_MS = 1000;
const PREVIEW_OFFSET = 14;
const PREVIEW_WIDTH = 420;
const PREVIEW_HEIGHT = 360;
const previewCache = new Map<string, Promise<WikiLinkPreviewPage | null>>();

export function createWikiLinkPreviewController(root: HTMLElement): WikiLinkPreviewController {
  const card = createPreviewCard();
  const controller = new AbortController();
  let hoverTimer: number | null = null;
  let currentLink: HTMLAnchorElement | null = null;

  root.appendChild(card);
  root.addEventListener("mouseover", onMouseOver, { signal: controller.signal });
  root.addEventListener("mouseout", onMouseOut, { signal: controller.signal });

  return {
    dispose() {
      controller.abort();
      cancelHover();
      card.remove();
    },
    hide,
  };

  function onMouseOver(event: MouseEvent): void {
    const link = findEventWikiLink(event);
    if (!link || !root.contains(link) || link === currentLink) {
      return;
    }
    const path = readWikiLinkPath(link);
    if (!path) {
      return;
    }
    currentLink = link;
    cancelHover();
    const preview = getPreviewPage(path);
    hoverTimer = window.setTimeout(() => {
      void showPreview(link, preview);
    }, HOVER_DELAY_MS);
  }

  function onMouseOut(event: MouseEvent): void {
    const link = findEventWikiLink(event);
    if (!link || event.relatedTarget instanceof Node && link.contains(event.relatedTarget)) {
      return;
    }
    if (link === currentLink) {
      hide();
    }
  }

  async function showPreview(
    link: HTMLAnchorElement,
    preview: Promise<WikiLinkPreviewPage | null>,
  ): Promise<void> {
    try {
      renderLoading(card, link);
      const page = await preview;
      if (!page || link !== currentLink) {
        return;
      }
      renderPreview(card, page);
      placePreview(card, link);
    } catch {
      hide();
    }
  }

  function hide(): void {
    cancelHover();
    currentLink = null;
    card.hidden = true;
  }

  function cancelHover(): void {
    if (hoverTimer !== null) {
      window.clearTimeout(hoverTimer);
      hoverTimer = null;
    }
  }
}

function findEventWikiLink(event: MouseEvent): HTMLAnchorElement | null {
  if (!(event.target instanceof Element)) {
    return null;
  }
  return event.target.closest<HTMLAnchorElement>("a.wikilink");
}

function createPreviewCard(): HTMLElement {
  const card = document.createElement("aside");
  card.className = "wiki-link-preview";
  card.hidden = true;
  card.setAttribute("aria-live", "polite");
  return card;
}

async function fetchPreviewPage(
  path: string,
): Promise<WikiLinkPreviewPage | null> {
  const response = await fetch(`/api/page?path=${encodeURIComponent(path)}&raw=0`);
  if (!response.ok) {
    return null;
  }
  return (await response.json()) as WikiLinkPreviewPage;
}

function getPreviewPage(path: string): Promise<WikiLinkPreviewPage | null> {
  const cached = previewCache.get(path);
  if (cached) {
    return cached;
  }
  const preview = fetchPreviewPage(path).catch(() => null);
  previewCache.set(path, preview);
  return preview;
}

function renderLoading(card: HTMLElement, link: HTMLAnchorElement): void {
  card.innerHTML = `<div class="wiki-link-preview__empty">正在加载 ${escapeHtml(link.textContent?.trim() || "页面")}...</div>`;
  placePreview(card, link);
  card.hidden = false;
}

function renderPreview(card: HTMLElement, page: WikiLinkPreviewPage): void {
  const imageUrl = extractPreviewImageUrl(page);
  const image = imageUrl
    ? `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(page.title ?? page.path)}" />`
    : `<div class="wiki-link-preview__image-fallback">${escapeHtml(buildInitial(page.title ?? page.path))}</div>`;
  card.innerHTML = `
    <div class="wiki-link-preview__image">${image}</div>
    <div class="wiki-link-preview__body">
      <h2>${escapeHtml(page.title ?? page.path)}</h2>
      <p>${escapeHtml(extractPreviewText(page.html))}</p>
    </div>
  `;
  card.hidden = false;
}

function extractPreviewImageUrl(page: WikiLinkPreviewPage): string | null {
  const sideImagePath = readFrontmatterString(page.frontmatter, "side_image");
  if (sideImagePath) {
    return `/api/page-side-image?path=${encodeURIComponent(sideImagePath)}`;
  }
  const htmlMatch = page.html.match(/<img[^>]+src=["']([^"']+)["']/iu);
  return htmlMatch?.[1] ?? null;
}

function extractPreviewText(html: string): string {
  const parser = new DOMParser();
  const documentNode = parser.parseFromString(html, "text/html");
  documentNode.querySelectorAll("script,style,img").forEach((node) => node.remove());
  const text = (documentNode.body.textContent ?? "").replace(/\s+/gu, " ").trim();
  return text || "这个页面还没有可预览的正文。";
}

function readWikiLinkPath(link: HTMLAnchorElement): string {
  const url = new URL(link.href, window.location.origin);
  return url.searchParams.get("page") ?? "";
}

function placePreview(card: HTMLElement, link: HTMLAnchorElement): void {
  const rect = link.getBoundingClientRect();
  const left = Math.min(rect.left, window.innerWidth - PREVIEW_WIDTH - PREVIEW_OFFSET);
  const aboveTop = rect.top - PREVIEW_HEIGHT - PREVIEW_OFFSET;
  const belowTop = rect.bottom + PREVIEW_OFFSET;
  const top = aboveTop > PREVIEW_OFFSET ? aboveTop : belowTop;
  card.style.left = `${Math.max(PREVIEW_OFFSET, left)}px`;
  card.style.top = `${Math.max(PREVIEW_OFFSET, top)}px`;
}

function readFrontmatterString(
  frontmatter: Record<string, unknown> | null | undefined,
  key: string,
): string {
  const candidate = frontmatter?.[key];
  return typeof candidate === "string" ? candidate.trim().replace(/^['"]|['"]$/gu, "") : "";
}

function buildInitial(value: string): string {
  return value.trim().charAt(0).toUpperCase() || "W";
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
