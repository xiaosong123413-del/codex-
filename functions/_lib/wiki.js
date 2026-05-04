/**
 * Shared Cloudflare Pages wiki API helpers.
 *
 * These helpers adapt the published `wiki_pages` D1 table to the same JSON
 * shapes consumed by the desktop WebUI wiki renderer. The HTML renderer is a
 * small safe Markdown subset so the hosted site can run without a Node server.
 */

const WIKI_PATH_PREFIX = "wiki/";

export async function readWikiPage(db, requestedPath) {
  const path = normalizeWikiPath(requestedPath);
  const row = await db.prepare(
    "SELECT path, title, content, content_hash AS version, modified_at AS modifiedAt, published_at AS publishedAt, updated_at AS updatedAt FROM wiki_pages WHERE path = ?",
  ).bind(path).first();
  return row ? wikiPageFromRow(row) : null;
}

export async function readWikiTree(db) {
  const result = await db.prepare(
    "SELECT path, title, modified_at AS modifiedAt, published_at AS publishedAt, updated_at AS updatedAt FROM wiki_pages WHERE path LIKE ? ORDER BY path LIMIT 2000",
  ).bind(`${WIKI_PATH_PREFIX}%`).all();
  return buildWikiTree(result.results ?? []);
}

export async function searchWikiPages(db, query) {
  const text = String(query ?? "").trim();
  if (!text) return [];
  const like = `%${text}%`;
  const result = await db.prepare(
    "SELECT path, title, substr(content, 1, 500) AS excerpt, modified_at AS modifiedAt, published_at AS publishedAt, updated_at AS updatedAt FROM wiki_pages WHERE path LIKE ? AND (title LIKE ? OR path LIKE ? OR content LIKE ?) ORDER BY published_at DESC, updated_at DESC LIMIT 60",
  ).bind(`${WIKI_PATH_PREFIX}%`, like, like, like).all();
  return (result.results ?? []).map(searchResultFromRow);
}

export function normalizeWikiPath(value) {
  const text = String(value ?? "").trim().replace(/^\/+/u, "");
  if (!text) return "wiki/index.md";
  const withPrefix = text.startsWith(WIKI_PATH_PREFIX) ? text : `${WIKI_PATH_PREFIX}${text}`;
  return withPrefix.endsWith(".md") ? withPrefix : `${withPrefix}.md`;
}

function wikiPageFromRow(row) {
  const raw = String(row.content ?? "");
  const parsed = parseMarkdownPage(raw);
  const title = String(row.title ?? "").trim() || parsed.title || titleFromPath(row.path);
  return {
    path: String(row.path ?? ""),
    title,
    html: renderMarkdown(parsed.body),
    raw,
    frontmatter: parsed.frontmatter,
    aliases: [],
    sizeBytes: new TextEncoder().encode(raw).length,
    modifiedAt: String(row.modifiedAt ?? row.publishedAt ?? row.updatedAt ?? ""),
    sourceEditable: false,
  };
}

function searchResultFromRow(row) {
  return {
    path: String(row.path ?? ""),
    title: String(row.title ?? "").trim() || titleFromPath(row.path),
    excerpt: normalizeExcerpt(row.excerpt),
    tags: [],
    modifiedAt: String(row.modifiedAt ?? row.publishedAt ?? row.updatedAt ?? ""),
  };
}

function buildWikiTree(rows) {
  const root = { name: "wiki", path: "wiki", kind: "dir", children: [] };
  for (const row of rows) {
    insertTreePath(root, String(row.path ?? ""), String(row.modifiedAt ?? row.publishedAt ?? row.updatedAt ?? ""));
  }
  sortTree(root);
  return root;
}

function insertTreePath(root, filePath, modifiedAt) {
  const parts = filePath.split("/").filter(Boolean);
  if (parts[0] === "wiki") parts.shift();
  let node = root;
  let currentPath = "wiki";
  for (let index = 0; index < parts.length; index += 1) {
    const name = parts[index];
    currentPath = `${currentPath}/${name}`;
    const isFile = index === parts.length - 1;
    const child = findOrCreateChild(node, name, currentPath, isFile ? "file" : "dir");
    if (isFile) child.modifiedAt = modifiedAt;
    node = child;
  }
}

function findOrCreateChild(parent, name, nodePath, kind) {
  let child = parent.children.find((item) => item.name === name && item.kind === kind);
  if (!child) {
    child = { name, path: nodePath, kind, children: kind === "dir" ? [] : undefined };
    parent.children.push(child);
  }
  return child;
}

function sortTree(node) {
  if (!Array.isArray(node.children)) return;
  node.children.sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === "dir" ? -1 : 1;
    return left.name.localeCompare(right.name, "zh-CN");
  });
  for (const child of node.children) sortTree(child);
}

function parseMarkdownPage(raw) {
  const normalized = String(raw ?? "").replace(/^\uFEFF/u, "");
  const match = normalized.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/u);
  const frontmatter = match ? parseFrontmatter(match[1]) : null;
  const body = match ? normalized.slice(match[0].length) : normalized;
  const heading = body.match(/^#\s+(.+?)\s*$/mu)?.[1]?.trim() ?? "";
  const title = readFrontmatterTitle(frontmatter) || heading;
  return { body, frontmatter, title };
}

function parseFrontmatter(text) {
  const out = {};
  for (const line of String(text ?? "").split(/\r?\n/u)) {
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    out[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  return out;
}

function readFrontmatterTitle(frontmatter) {
  const title = frontmatter?.title;
  return typeof title === "string" ? title.replace(/^["']|["']$/gu, "").trim() : "";
}

function renderMarkdown(markdown) {
  const lines = String(markdown ?? "").split(/\r?\n/u);
  const html = [];
  let paragraph = [];
  let listItems = [];
  let inCode = false;
  let codeLines = [];
  for (const line of lines) {
    if (line.trim().startsWith("```")) {
      ({ inCode, codeLines } = toggleCodeBlock({ inCode, codeLines, line, html, paragraph, listItems }));
      paragraph = [];
      listItems = [];
      continue;
    }
    if (inCode) {
      codeLines.push(line);
      continue;
    }
    ({ paragraph, listItems } = renderMarkdownLine(line, html, paragraph, listItems));
  }
  flushParagraph(html, paragraph);
  flushList(html, listItems);
  if (inCode) html.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
  return html.join("\n");
}

function toggleCodeBlock(state) {
  flushParagraph(state.html, state.paragraph);
  flushList(state.html, state.listItems);
  if (!state.inCode) return { inCode: true, codeLines: [] };
  state.html.push(`<pre><code>${escapeHtml(state.codeLines.join("\n"))}</code></pre>`);
  return { inCode: false, codeLines: [] };
}

function renderMarkdownLine(line, html, paragraph, listItems) {
  const trimmed = line.trim();
  if (!trimmed) {
    flushParagraph(html, paragraph);
    flushList(html, listItems);
    return { paragraph: [], listItems: [] };
  }
  const heading = trimmed.match(/^(#{1,6})\s+(.+)$/u);
  if (heading) {
    flushParagraph(html, paragraph);
    flushList(html, listItems);
    html.push(renderHeading(heading[1].length, heading[2]));
    return { paragraph: [], listItems: [] };
  }
  const list = trimmed.match(/^[-*]\s+(.+)$/u);
  if (list) {
    flushParagraph(html, paragraph);
    return { paragraph: [], listItems: [...listItems, renderInline(list[1])] };
  }
  flushList(html, listItems);
  return { paragraph: [...paragraph, trimmed], listItems: [] };
}

function renderHeading(level, text) {
  const normalizedLevel = Math.min(Math.max(level, 1), 6);
  const label = renderInline(text);
  const id = headingId(stripMarkdown(text));
  return `<h${normalizedLevel} id="${escapeHtml(id)}"><a class="header-anchor" href="#${encodeURIComponent(id)}">§</a> ${label}</h${normalizedLevel}>`;
}

function flushParagraph(html, paragraph) {
  if (paragraph.length === 0) return;
  html.push(`<p>${renderInline(paragraph.join(" "))}</p>`);
}

function flushList(html, listItems) {
  if (listItems.length === 0) return;
  html.push(`<ul>${listItems.map((item) => `<li>${item}</li>`).join("")}</ul>`);
}

function renderInline(value) {
  return escapeHtml(String(value ?? ""))
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/gu, '<img src="$2" alt="$1">')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/gu, '<a href="$2">$1</a>')
    .replace(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/gu, (_match, target, label) => {
      const text = label || target;
      return `<a class="wikilink" href="#/wiki/${encodeURIComponent(normalizeWikiPath(target))}">${escapeHtml(text)}</a>`;
    })
    .replace(/\*\*([^*]+)\*\*/gu, "<strong>$1</strong>")
    .replace(/`([^`]+)`/gu, "<code>$1</code>");
}

function headingId(value) {
  const text = String(value ?? "").trim().toLowerCase();
  return encodeURIComponent(text.replace(/\s+/gu, "-")) || "section";
}

function stripMarkdown(value) {
  return String(value ?? "")
    .replace(/\[([^\]]+)\]\([^)]+\)/gu, "$1")
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/gu, "$2$1")
    .replace(/[*_`#]/gu, "")
    .trim();
}

function normalizeExcerpt(value) {
  return stripMarkdown(String(value ?? "")).replace(/\s+/gu, " ").slice(0, 220);
}

function titleFromPath(value) {
  const base = String(value ?? "").split("/").pop() || "Wiki";
  return base.replace(/\.md$/iu, "").replace(/[-_]+/gu, " ");
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"]/gu, (character) => {
    const escaped = { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" };
    return escaped[character] ?? character;
  });
}
