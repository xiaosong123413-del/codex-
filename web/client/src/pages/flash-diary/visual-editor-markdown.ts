/**
 * Flash-diary visual editor markdown helpers.
 *
 * Converts rendered diary markdown into a mixed editable HTML surface and
 * serializes edited diary HTML back into plain markdown with real media syntax.
 */
const DIARY_IMAGE_RE = /!\[([^\]]*)\]\(([^)]+)\)/gu;
const MARKDOWN_MEDIA_BLOCK_SELECTOR = "[data-flash-diary-media-block]";
const BLOCK_TAGS = new Set(["P", "DIV", "H1", "H2", "H3", "H4", "H5", "H6", "UL", "OL", "BLOCKQUOTE", "PRE", "HR"]);
const VIDEO_EXTENSIONS_RE = /\.(mp4|mov|m4v|webm|avi|mkv)(?:[?#].*)?$/iu;

export function createDiaryEditorHtml(raw: string, renderedHtml: string, diaryPath: string): string {
  const wrapper = document.createElement("div");
  wrapper.innerHTML = renderedHtml.trim() || renderFallbackDiaryHtml(raw);
  decorateDiaryImages(wrapper, diaryPath);
  return wrapper.innerHTML;
}

export function serializeDiaryEditor(root: HTMLElement): string {
  const markdown = Array.from(root.childNodes).map((node) => renderMarkdownNode(node)).join("").replace(/\n{3,}/gu, "\n\n");
  return markdown.trimEnd() ? `${markdown.trimEnd()}\n` : "";
}

export function buildDiaryMediaUrl(logicalPath: string): string {
  return `/api/flash-diary/media?path=${encodeURIComponent(logicalPath)}`;
}

function resolveDiaryMediaLogicalPath(diaryPath: string, reference: string): string | null {
  const normalizedDiaryPath = normalizeLogicalPath(diaryPath);
  const normalizedReference = normalizeMarkdownPath(reference);
  if (!normalizedDiaryPath || !normalizedReference) {
    return null;
  }
  const diaryDirectory = normalizedDiaryPath.slice(0, normalizedDiaryPath.lastIndexOf("/")) || "";
  const logicalPath = normalizedReference.startsWith("raw/")
    ? normalizedReference
    : normalizeLogicalPath(`${diaryDirectory}/${normalizedReference}`);
  if (!logicalPath || !logicalPath.startsWith("raw/闪念日记/assets/")) {
    return null;
  }
  return logicalPath;
}

export function toDiaryRelativeMediaPath(diaryPath: string, logicalMediaPath: string): string {
  const normalizedDiaryPath = normalizeLogicalPath(diaryPath) ?? diaryPath;
  const normalizedMediaPath = normalizeLogicalPath(logicalMediaPath) ?? logicalMediaPath;
  const diaryDirectory = normalizedDiaryPath.slice(0, normalizedDiaryPath.lastIndexOf("/")) || "";
  const relative = toPosixRelative(diaryDirectory, normalizedMediaPath);
  return relative.startsWith(".") ? relative : `./${relative}`;
}

export function isEditorTopLevelBlock(node: Node | null, root: HTMLElement): node is HTMLElement {
  return node instanceof HTMLElement && node.parentElement === root && BLOCK_TAGS.has(node.tagName);
}

function decorateDiaryImages(wrapper: HTMLElement, diaryPath: string): void {
  const images = Array.from(wrapper.querySelectorAll("img"));
  for (const image of images) {
    replaceRenderedImage(image, diaryPath);
  }
  const links = Array.from(wrapper.querySelectorAll("a"));
  for (const link of links) {
    replaceRenderedVideoLink(link, diaryPath);
  }
}

function replaceRenderedImage(image: HTMLImageElement, diaryPath: string): void {
  const markdownPath = normalizeMarkdownPath(image.getAttribute("src") ?? "");
  const logicalPath = markdownPath ? resolveDiaryMediaLogicalPath(diaryPath, markdownPath) : null;
  if (!markdownPath || !logicalPath) {
    return;
  }
  const figure = createMediaFigure({
    kind: "image",
    alt: image.getAttribute("alt") || "图片",
    label: "",
    logicalPath,
    markdownPath: toDiaryRelativeMediaPath(diaryPath, logicalPath),
  });
  const paragraph = image.parentElement;
  if (isImageOnlyParagraph(paragraph, image)) {
    paragraph.replaceWith(figure);
    return;
  }
  if (paragraph instanceof HTMLParagraphElement) {
    replaceImageWithinParagraph(paragraph, image, figure);
    return;
  }
  image.replaceWith(figure);
}

function replaceRenderedVideoLink(link: HTMLAnchorElement, diaryPath: string): void {
  const markdownPath = normalizeMarkdownPath(link.getAttribute("href") ?? "");
  if (!markdownPath || !isDiaryVideoPath(markdownPath)) {
    return;
  }
  const logicalPath = resolveDiaryMediaLogicalPath(diaryPath, markdownPath);
  if (!logicalPath) {
    return;
  }
  const figure = createMediaFigure({
    kind: "video",
    alt: "",
    label: link.textContent?.trim() || `视频：${logicalPath.split("/").pop() ?? "video"}`,
    logicalPath,
    markdownPath: toDiaryRelativeMediaPath(diaryPath, logicalPath),
  });
  const paragraph = link.parentElement;
  if (isLinkOnlyParagraph(paragraph, link)) {
    paragraph.replaceWith(figure);
    return;
  }
  link.replaceWith(figure);
}

function replaceImageWithinParagraph(
  paragraph: HTMLParagraphElement,
  image: HTMLImageElement,
  figure: HTMLElement,
): void {
  const children = Array.from(paragraph.childNodes);
  const imageIndex = children.indexOf(image);
  if (imageIndex < 0) {
    paragraph.replaceWith(figure);
    return;
  }
  const replacement = [
    ...createParagraphSegmentNodes(children.slice(0, imageIndex)),
    figure,
    ...createParagraphSegmentNodes(children.slice(imageIndex + 1)),
  ];
  paragraph.replaceWith(...replacement);
}

function createParagraphSegmentNodes(nodes: readonly ChildNode[]): Node[] {
  if (nodes.length === 0) {
    return [];
  }
  const plainText = toPlainTextSegment(nodes);
  if (plainText !== null) {
    return createFallbackBlocks(plainText);
  }
  const paragraph = document.createElement("p");
  for (const node of nodes) {
    paragraph.append(node.cloneNode(true));
  }
  return hasMeaningfulContent(paragraph) ? [paragraph] : [];
}

function toPlainTextSegment(nodes: readonly ChildNode[]): string | null {
  const lines: string[] = [];
  for (const node of nodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      lines.push(node.textContent ?? "");
      continue;
    }
    if (node instanceof HTMLBRElement) {
      lines.push("\n");
      continue;
    }
    return null;
  }
  return lines.join("");
}

function createFallbackBlocks(raw: string): Node[] {
  const wrapper = document.createElement("div");
  wrapper.innerHTML = renderFallbackDiaryHtml(raw);
  return Array.from(wrapper.childNodes);
}

function createMediaFigure(input: {
  kind: "image" | "video";
  alt: string;
  label: string;
  logicalPath: string;
  markdownPath: string;
}): HTMLElement {
  const figure = document.createElement("figure");
  figure.className = "flash-diary-visual-editor__image-block";
  figure.contentEditable = "false";
  figure.dataset.flashDiaryMediaBlock = "true";
  figure.dataset.flashDiaryMediaKind = input.kind;
  figure.dataset.flashDiaryLogicalPath = input.logicalPath;
  figure.dataset.flashDiaryMarkdownPath = input.markdownPath;
  figure.dataset.flashDiaryMarkdownLabel = input.label;
  if (input.kind === "image") {
    figure.dataset.flashDiaryImageBlock = "true";
    const image = document.createElement("img");
    image.className = "flash-diary-visual-editor__image-thumb";
    image.dataset.flashDiaryImageThumb = "true";
    image.src = buildDiaryMediaUrl(input.logicalPath);
    image.alt = input.alt;
    figure.append(image);
  } else {
    figure.dataset.flashDiaryVideoBlock = "true";
    const video = document.createElement("video");
    video.className = "flash-diary-visual-editor__video-thumb";
    video.dataset.flashDiaryVideoThumb = "true";
    video.src = buildDiaryMediaUrl(input.logicalPath);
    video.controls = true;
    video.preload = "metadata";
    figure.append(video);
  }
  const footer = document.createElement("figcaption");
  footer.textContent = input.kind === "image" ? "点击查看原图" : input.label;
  figure.append(footer);
  return figure;
}

function isImageOnlyParagraph(element: Element | null, image: HTMLImageElement): element is HTMLParagraphElement {
  if (!(element instanceof HTMLParagraphElement)) {
    return false;
  }
  const content = element.textContent?.trim() ?? "";
  return content.length === 0 && element.childElementCount === 1 && element.firstElementChild === image;
}

function isLinkOnlyParagraph(element: Element | null, link: HTMLAnchorElement): element is HTMLParagraphElement {
  if (!(element instanceof HTMLParagraphElement)) {
    return false;
  }
  return element.textContent?.trim() === link.textContent?.trim() && element.childElementCount === 1;
}

function renderFallbackDiaryHtml(raw: string): string {
  const lines = raw.replace(/\r\n/gu, "\n").split("\n");
  const blocks: string[] = [];
  const paragraphLines: string[] = [];
  flushParagraph(blocks, paragraphLines);
  for (const line of lines) {
    if (pushStandaloneBlock(blocks, paragraphLines, line)) {
      continue;
    }
    if (!line.trim()) {
      flushParagraph(blocks, paragraphLines);
      continue;
    }
    paragraphLines.push(line);
  }
  flushParagraph(blocks, paragraphLines);
  return blocks.join("");
}

// fallow-ignore-next-line complexity
function pushStandaloneBlock(blocks: string[], paragraphLines: string[], line: string): boolean {
  const headingMatch = /^(#{1,6})\s+(.+)$/u.exec(line);
  if (headingMatch) {
    flushParagraph(blocks, paragraphLines);
    blocks.push(`<h${headingMatch[1].length}>${escapeHtml(headingMatch[2])}</h${headingMatch[1].length}>`);
    return true;
  }
  if (line.trim() === "---") {
    flushParagraph(blocks, paragraphLines);
    blocks.push("<hr>");
    return true;
  }
  const imageMatch = DIARY_IMAGE_RE.exec(line);
  DIARY_IMAGE_RE.lastIndex = 0;
  if (imageMatch) {
    flushParagraph(blocks, paragraphLines);
    blocks.push(`<p><img src="${escapeHtml(imageMatch[2])}" alt="${escapeHtml(imageMatch[1] || "图片")}"></p>`);
    return true;
  }
  const videoMatch = /^\[([^\]]+)\]\(([^)]+)\)$/u.exec(line.trim());
  if (videoMatch && isDiaryVideoPath(videoMatch[2] ?? "")) {
    flushParagraph(blocks, paragraphLines);
    blocks.push(`<p><a href="${escapeHtml(videoMatch[2] ?? "")}">${escapeHtml(videoMatch[1] ?? "视频")}</a></p>`);
    return true;
  }
  return false;
}

function flushParagraph(blocks: string[], paragraphLines: string[]): void {
  if (paragraphLines.length === 0) {
    return;
  }
  blocks.push(`<p>${escapeHtml(paragraphLines.join("\n"))}</p>`);
  paragraphLines.length = 0;
}

function renderMarkdownNode(node: ChildNode): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent ?? "";
  }
  if (!(node instanceof HTMLElement)) {
    return "";
  }
  if (node.matches(MARKDOWN_MEDIA_BLOCK_SELECTOR)) {
    return renderMarkdownFigure(node);
  }
  const renderer = MARKDOWN_RENDERERS[node.tagName.toLowerCase()];
  return renderer ? renderer(node) : renderInlineMarkdown(Array.from(node.childNodes));
}

function renderMarkdownFigure(node: HTMLElement): string {
  const markdownPath = node.dataset.flashDiaryMarkdownPath ?? "";
  if (node.dataset.flashDiaryMediaKind === "video") {
    const label = node.dataset.flashDiaryMarkdownLabel || `视频：${markdownPath.split("/").pop() ?? "video"}`;
    return `[${label}](${markdownPath})\n\n`;
  }
  const alt = node.querySelector("img")?.getAttribute("alt") || "图片";
  return `![${alt}](${markdownPath})\n\n`;
}

function renderInlineMarkdown(nodes: readonly ChildNode[]): string {
  return nodes.map((node) => renderInlineNode(node)).join("");
}

function renderInlineNode(node: ChildNode): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent ?? "";
  }
  if (!(node instanceof HTMLElement)) {
    return "";
  }
  if (node.matches(MARKDOWN_MEDIA_BLOCK_SELECTOR)) {
    return renderMarkdownFigure(node);
  }
  const renderer = INLINE_RENDERERS[node.tagName.toLowerCase()];
  return renderer ? renderer(node) : renderInlineMarkdown(Array.from(node.childNodes));
}

function renderMarkdownParagraph(node: HTMLElement): string {
  return `${renderInlineMarkdown(Array.from(node.childNodes)).trim()}\n\n`;
}

function renderMarkdownHeading(node: HTMLElement, prefix: string): string {
  return `${prefix} ${renderInlineMarkdown(Array.from(node.childNodes)).trim()}\n\n`;
}

function renderMarkdownList(node: HTMLElement, ordered: boolean): string {
  const lines = Array.from(node.children).map((child, index) => {
    const prefix = ordered ? `${index + 1}.` : "-";
    return `${prefix} ${renderInlineMarkdown(Array.from(child.childNodes)).trim()}`;
  });
  return `${lines.join("\n")}\n\n`;
}

function renderMarkdownBlockquote(node: HTMLElement): string {
  const text = renderInlineMarkdown(Array.from(node.childNodes)).trim().split("\n").map((line) => `> ${line}`).join("\n");
  return `${text}\n\n`;
}

function renderMarkdownContainer(node: HTMLElement): string {
  const content = Array.from(node.childNodes).map((child) => renderMarkdownNode(child)).join("");
  return /\n\n$/u.test(content) ? content : `${content}\n\n`;
}

const MARKDOWN_RENDERERS: Record<string, (node: HTMLElement) => string> = {
  article: (node) => renderMarkdownContainer(node),
  blockquote: (node) => renderMarkdownBlockquote(node),
  div: (node) => renderMarkdownParagraph(node),
  h1: (node) => renderMarkdownHeading(node, "#"),
  h2: (node) => renderMarkdownHeading(node, "##"),
  h3: (node) => renderMarkdownHeading(node, "###"),
  h4: (node) => renderMarkdownHeading(node, "####"),
  h5: (node) => renderMarkdownHeading(node, "#####"),
  h6: (node) => renderMarkdownHeading(node, "######"),
  hr: () => "---\n\n",
  ol: (node) => renderMarkdownList(node, true),
  p: (node) => renderMarkdownParagraph(node),
  pre: (node) => `\`\`\`\n${node.textContent?.trim() ?? ""}\n\`\`\`\n\n`,
  section: (node) => renderMarkdownContainer(node),
  ul: (node) => renderMarkdownList(node, false),
};

const INLINE_RENDERERS: Record<string, (node: HTMLElement) => string> = {
  a: (node) => `[${renderInlineMarkdown(Array.from(node.childNodes))}](${node.getAttribute("href") ?? ""})`,
  b: (node) => `**${renderInlineMarkdown(Array.from(node.childNodes))}**`,
  br: () => "\n",
  code: (node) => `\`${node.textContent ?? ""}\``,
  em: (node) => `*${renderInlineMarkdown(Array.from(node.childNodes))}*`,
  i: (node) => `*${renderInlineMarkdown(Array.from(node.childNodes))}*`,
  strong: (node) => `**${renderInlineMarkdown(Array.from(node.childNodes))}**`,
};

function normalizeLogicalPath(value: string): string | null {
  const normalized = value.replace(/\\/gu, "/").replace(/^\/+/u, "");
  if (!normalized) {
    return null;
  }
  const segments = normalized.split("/");
  const result: string[] = [];
  for (const segment of segments) {
    if (!segment || segment === ".") {
      continue;
    }
    if (segment === "..") {
      result.pop();
      continue;
    }
    result.push(segment);
  }
  return result.join("/");
}

function normalizeMarkdownPath(value: string): string | null {
  const normalized = value.trim().replace(/^<|>$/gu, "");
  return normalized || null;
}

export function isDiaryVideoPath(value: string): boolean {
  return VIDEO_EXTENSIONS_RE.test(value.trim());
}

function toPosixRelative(fromDirectory: string, targetPath: string): string {
  const fromSegments = fromDirectory.split("/").filter(Boolean);
  const targetSegments = targetPath.split("/").filter(Boolean);
  while (fromSegments.length > 0 && targetSegments.length > 0 && fromSegments[0] === targetSegments[0]) {
    fromSegments.shift();
    targetSegments.shift();
  }
  return `${"../".repeat(fromSegments.length)}${targetSegments.join("/")}` || ".";
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/gu, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      default:
        return "&quot;";
    }
  });
}
