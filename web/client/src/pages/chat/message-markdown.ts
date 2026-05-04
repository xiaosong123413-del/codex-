/**
 * Lightweight markdown rendering helpers for chat messages.
 *
 * The chat page only needs a predictable subset of markdown, so this module
 * keeps the parser small, dependency-free, and easy to test in isolation.
 */

interface RenderedBlock {
  html: string;
  nextIndex: number;
}

export interface ThinkingBlock {
  content: string;
}

export function isCompactMessage(content: string): boolean {
  const normalized = normalizeMessageContent(content);
  return normalized.length > 0 && !normalized.includes("\n") && stripInlineMarkdown(normalized).length <= 40;
}

export function renderMessageHtml(content: string): string {
  const normalized = normalizeMessageContent(content);
  if (!normalized) {
    return "<p></p>";
  }
  return renderBlocks(normalized.split("\n"));
}

export function extractThinkingBlocks(content: string): ThinkingBlock[] {
  const blocks: ThinkingBlock[] = [];
  const normalized = normalizeLineEndings(content);
  for (const match of normalized.matchAll(/<(think|thinking)>([\s\S]*?)(?:<\/\1>|$)/giu)) {
    const thinking = (match[2] ?? "").trim();
    if (thinking) {
      blocks.push({ content: thinking });
    }
  }
  return blocks;
}

function normalizeMessageContent(content: string): string {
  return stripThinkingBlocks(stripCitedComments(normalizeLineEndings(content))).trim();
}

function normalizeLineEndings(content: string): string {
  return content.replace(/\r\n?/g, "\n");
}

function stripCitedComments(content: string): string {
  return content.replace(/<!--\s*cited:\s*[0-9,\s]+\s*-->/gi, "");
}

function stripThinkingBlocks(content: string): string {
  return content
    .replace(/<(think|thinking)>\s*[\s\S]*?(?:<\/\1>|$)/giu, "")
    .trim();
}

function renderBlocks(lines: string[]): string {
  const blocks: string[] = [];
  let index = 0;
  while (index < lines.length) {
    const block = readNextBlock(lines, index);
    if (block) {
      blocks.push(block.html);
      index = block.nextIndex;
      continue;
    }
    index += 1;
  }
  return blocks.join("");
}

function readNextBlock(lines: string[], index: number): RenderedBlock | null {
  const line = lines[index] ?? "";
  if (line.trim().length === 0) {
    return null;
  }
  if (/^```/.test(line)) {
    return readFencedCodeBlock(lines, index);
  }
  if (/^(#{1,6})\s+/.test(line)) {
    return readHeadingBlock(line, index);
  }
  if (/^\s*[-+*]\s+/.test(line)) {
    return readListBlock(lines, index, "ul", /^\s*[-+*]\s+/, /^\s*[-+*]\s+/);
  }
  if (/^\s*\d+\.\s+/.test(line)) {
    return readListBlock(lines, index, "ol", /^\s*\d+\.\s+/, /^\s*\d+\.\s+/);
  }
  if (/^\s*>\s?/.test(line)) {
    return readQuoteBlock(lines, index);
  }
  return readParagraphBlock(lines, index);
}

function readFencedCodeBlock(lines: string[], startIndex: number): RenderedBlock {
  const openingLine = lines[startIndex] ?? "";
  const fenceMatch = openingLine.match(/^```([^`]*)$/);
  const language = fenceMatch?.[1]?.trim();
  const codeLines: string[] = [];
  let index = startIndex + 1;
  while (index < lines.length && !/^```/.test(lines[index] ?? "")) {
    codeLines.push(lines[index] ?? "");
    index += 1;
  }
  if (index < lines.length) {
    index += 1;
  }
  const languageAttr = language ? ` data-language="${escapeHtml(language)}"` : "";
  return {
    html: `<pre><code${languageAttr}>${escapeHtml(codeLines.join("\n"))}</code></pre>`,
    nextIndex: index,
  };
}

function readHeadingBlock(line: string, startIndex: number): RenderedBlock {
  const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
  const level = headingMatch?.[1].length ?? 1;
  const body = headingMatch?.[2] ?? "";
  return {
    html: `<h${level}>${renderInlineMarkdown(body)}</h${level}>`,
    nextIndex: startIndex + 1,
  };
}

function readListBlock(
  lines: string[],
  startIndex: number,
  tagName: "ul" | "ol",
  itemPattern: RegExp,
  prefixPattern: RegExp,
): RenderedBlock {
  const items: string[] = [];
  let index = startIndex;
  while (index < lines.length && itemPattern.test(lines[index] ?? "")) {
    const item = (lines[index] ?? "").replace(prefixPattern, "");
    items.push(renderInlineMarkdown(item));
    index += 1;
  }
  return {
    html: `<${tagName}>${items.map((item) => `<li>${item}</li>`).join("")}</${tagName}>`,
    nextIndex: index,
  };
}

function readQuoteBlock(lines: string[], startIndex: number): RenderedBlock {
  const quoteLines: string[] = [];
  let index = startIndex;
  while (index < lines.length && /^\s*>\s?/.test(lines[index] ?? "")) {
    quoteLines.push((lines[index] ?? "").replace(/^\s*>\s?/, ""));
    index += 1;
  }
  return {
    html: `<blockquote><p>${quoteLines.map((line) => renderInlineMarkdown(line)).join("<br>")}</p></blockquote>`,
    nextIndex: index,
  };
}

function readParagraphBlock(lines: string[], startIndex: number): RenderedBlock {
  const paragraphLines: string[] = [];
  let index = startIndex;
  while (index < lines.length) {
    const currentLine = lines[index] ?? "";
    if (currentLine.trim().length === 0 || isBlockStart(currentLine)) {
      break;
    }
    paragraphLines.push(currentLine);
    index += 1;
  }
  return {
    html: `<p>${paragraphLines.map((line) => renderInlineMarkdown(line)).join("<br>")}</p>`,
    nextIndex: index,
  };
}

function isBlockStart(line: string): boolean {
  return /^```/.test(line)
    || /^(#{1,6})\s+/.test(line)
    || /^\s*[-+*]\s+/.test(line)
    || /^\s*\d+\.\s+/.test(line)
    || /^\s*>\s?/.test(line);
}

function renderInlineMarkdown(value: string): string {
  let html = escapeHtml(value);
  html = html.replace(/`([^`]+)`/g, (_match, code: string) => `<code>${code}</code>`);
  html = html.replace(/\*\*([^*]+)\*\*/g, (_match, strong: string) => `<strong>${strong}</strong>`);
  html = html.replace(/__([^_]+)__/g, (_match, strong: string) => `<strong>${strong}</strong>`);
  html = html.replace(/\*([^*]+)\*/g, (_match, emphasis: string) => `<em>${emphasis}</em>`);
  html = html.replace(/_([^_]+)_/g, (_match, emphasis: string) => `<em>${emphasis}</em>`);
  html = html.replace(/~~([^~]+)~~/g, (_match, deleted: string) => `<del>${deleted}</del>`);
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_match, alt: string, src: string) => {
    const safeSrc = normalizeImageTarget(src);
    return safeSrc
      ? `<img src="${escapeHtml(safeSrc)}" alt="${alt}" loading="lazy" />`
      : alt;
  });
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label: string, href: string) => {
    const safeHref = normalizeLinkTarget(href);
    return safeHref
      ? `<a href="${escapeHtml(safeHref)}" target="_blank" rel="noreferrer">${label}</a>`
      : label;
  });
  return html;
}

function normalizeLinkTarget(value: string): string | null {
  const normalized = value.trim();
  return /^(https?:\/\/|mailto:)/i.test(normalized) ? normalized : null;
}

function normalizeImageTarget(value: string): string | null {
  const normalized = value.trim().replace(/^<|>$/g, "");
  if (/^(https?:\/\/|data:image\/)/i.test(normalized)) {
    return normalized;
  }
  if (/^(javascript:|data:)/i.test(normalized)) {
    return null;
  }
  return `/api/source-gallery/media?path=${encodeURIComponent(normalized.replace(/^\/+/, ""))}`;
}

function stripInlineMarkdown(value: string): string {
  return value
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
    .replace(/[*_`~>#-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
