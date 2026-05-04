#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { listFilesRecursive } from "./sync-compile/file-listing.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const wikiRoot = path.join(projectRoot, "wiki");
const outRoot = path.join(projectRoot, "dist", "static-wiki");
const webRequire = createRequire(path.join(projectRoot, "web", "package.json"));

let MarkdownIt;
try {
  MarkdownIt = webRequire("markdown-it");
} catch (error) {
  console.error("Cannot load markdown-it from web dependencies. Run: npm --prefix web install");
  throw error;
}

if (!fs.existsSync(wikiRoot) || !fs.statSync(wikiRoot).isDirectory()) {
  console.error(`Wiki directory does not exist: ${wikiRoot}`);
  process.exit(1);
}

const wikiFiles = (await listFilesRecursive(wikiRoot)).map((file) => path.join(wikiRoot, file));
const markdownFiles = wikiFiles.filter((file) => /\.md$/i.test(file));
const pages = markdownFiles.map((file) => {
  const rel = toPosix(path.relative(wikiRoot, file));
  const raw = fs.readFileSync(file, "utf8");
  const { body, title } = stripFrontmatter(raw);
  return {
    sourcePath: rel,
    outPath: rel.replace(/\.md$/i, ".html"),
    raw,
    body,
    title: title || rel.replace(/\.md$/i, ""),
    excerpt: firstText(body),
    text: plainText(body).slice(0, 12000),
  };
});

const pagesByStem = new Map();
const pagesByPath = new Map();
for (const page of pages) {
  pagesByPath.set(page.sourcePath, page);
  pagesByPath.set(page.sourcePath.replace(/\.md$/i, ""), page);
  pagesByStem.set(path.posix.basename(page.sourcePath, ".md"), page);
}

const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: false,
});

// fallow-ignore-next-line complexity
md.inline.ruler.before("link", "static-wikilink", (state, silent) => {
  if (state.src[state.pos] !== "[" || state.src[state.pos + 1] !== "[") return false;
  const match = /^\[\[([^\]|#]+)(?:#([^\]|]+))?(?:\|([^\]]+))?\]\]/.exec(state.src.slice(state.pos));
  if (!match) return false;
  if (!silent) {
    const target = match[1].trim();
    const anchor = match[2]?.trim() ?? "";
    const display = match[3]?.trim() || target;
    const resolved = resolveWikiLink(target);
    const tokenOpen = state.push("link_open", "a", 1);
    tokenOpen.attrs = [
      ["href", resolved ? pageHref(state.env.currentPage, resolved, anchor) : "#"],
      ["class", resolved ? "wikilink" : "wikilink wikilink-dead"],
    ];
    const text = state.push("text", "", 0);
    text.content = display;
    state.push("link_close", "a", -1);
  }
  state.pos += match[0].length;
  return true;
});

fs.rmSync(outRoot, { recursive: true, force: true });
fs.mkdirSync(outRoot, { recursive: true });

copyStaticWikiAssets();
writeStaticAssets();
writeAssistantPage();
for (const page of pages) {
  const target = path.join(outRoot, fromPosix(page.outPath));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, renderPage(page), "utf8");
}

console.log(`Exported ${pages.length} wiki pages to ${outRoot}`);

// fallow-ignore-next-line complexity
function stripFrontmatter(text) {
  const normalized = text.replace(/^\uFEFF/, "");
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(normalized);
  const body = match ? normalized.slice(match[0].length) : normalized;
  const titleMatch = /^#\s+(.+?)\s*$/m.exec(body);
  let title = titleMatch?.[1] ?? null;
  if (match) {
    for (const line of match[1].split(/\r?\n/)) {
      const idx = line.indexOf(":");
      if (idx > 0 && line.slice(0, idx).trim() === "title") {
        title = line.slice(idx + 1).trim() || title;
      }
    }
  }
  return { body, title };
}

function firstText(markdown) {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*]\([^)]+\)/g, " ")
    .replace(/\[[^\]]+]\([^)]+\)/g, " ")
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?]]/g, "$2 $1")
    .replace(/[#>*_`~\-\[\]()>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

function plainText(markdown) {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*]\([^)]+\)/g, " ")
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?]]/g, "$2 $1")
    .replace(/[#>*_`~\-\[\]()>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function searchIndex() {
  return pages.map((page) => ({
    title: page.title,
    path: page.sourcePath,
    href: encodeUriPath(page.outPath),
    excerpt: page.excerpt,
    text: page.text,
  }));
}

function renderPage(page) {
  const content = md.render(page.body, { currentPage: page });
  const nav = renderNav(page);
  const searchData = JSON.stringify(
    pages.map((item) => ({
      title: item.title,
      path: item.sourcePath,
      href: pageHref(page, item),
      excerpt: item.excerpt,
    }))
  ).replace(/</g, "\\u003c");

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(page.title)} · LLM Wiki</title>
  <link rel="stylesheet" href="${relativeAsset(page, "assets/wiki.css")}">
</head>
<body data-page-path="${escapeHtml(page.sourcePath)}">
  <a class="assistant-link" href="${relativeAsset(page, "assistant.html")}">AI 助手</a>
  <aside class="sidebar">
    <div class="brand"><a href="${pageHref(page, homePage())}">LLM Wiki</a></div>
    <label class="search-label" for="wiki-search">搜索</label>
    <input id="wiki-search" class="search-input" type="search" placeholder="搜索 Wiki 页面" autocomplete="off">
    <div id="search-results" class="search-results" hidden></div>
    <nav class="tree" aria-label="Wiki 目录">
      ${nav}
    </nav>
  </aside>
  <main class="content">
    <div class="page-path">${escapeHtml(page.sourcePath)}</div>
    <div class="wiki-actions">
      <a class="wiki-action" href="${relativeAsset(page, "assistant.html")}?page=${encodeURIComponent(page.sourcePath)}">对话</a>
      <button class="wiki-action" type="button" data-comments-toggle>评论</button>
    </div>
    <article class="markdown">
      ${content}
    </article>
  </main>
  <aside class="comments-panel" data-comments-panel hidden>
    <div class="comments-panel__header">
      <div>
        <strong>评论</strong>
        <span data-comments-count>0 条</span>
      </div>
      <button type="button" data-comments-close>关闭</button>
    </div>
    <p class="comments-panel__hint">选中文章文字后填写评论，会同步到桌面端。</p>
    <textarea data-comment-input rows="4" placeholder="写下评论..."></textarea>
    <button type="button" class="comments-panel__save" data-comment-save>保存评论</button>
    <div data-comments-list></div>
  </aside>
  <script>window.__WIKI_SEARCH__ = ${searchData};</script>
  <script src="${relativeAsset(page, "assets/wiki.js")}"></script>
</body>
</html>`;
}

function writeAssistantPage() {
  fs.writeFileSync(path.join(outRoot, "assistant.html"), `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>全站 Wiki 助手 · LLM Wiki</title>
  <link rel="stylesheet" href="./assets/wiki.css">
</head>
<body class="assistant-page">
  <main class="assistant-workspace">
    <aside class="assistant-file-tree">
      <a class="back-link" href="./index.html">← 返回 Wiki</a>
      <div class="assistant-file-tree__tabs">
        <button class="is-active" type="button">wiki</button>
        <button type="button">raw</button>
      </div>
      <input id="assistant-page-search" class="search-input" type="search" placeholder="搜索文件">
      <nav id="assistant-page-list" class="assistant-page-list"></nav>
    </aside>
    <aside class="assistant-conversations">
      <button id="chat-new-conversation" class="btn-primary" type="button">+ 新对话</button>
      <div id="chat-conversation-list" class="assistant-conversation-list">
        <p class="muted">暂无对话</p>
      </div>
    </aside>
    <section class="assistant-thread">
      <header class="assistant-thread__header">
        <div>
          <div class="eyebrow">CHAT</div>
          <h1 id="chat-thread-title">开始新对话</h1>
          <div class="assistant-runtime-card">
            <span>Agent</span><strong>Wiki Web 助手</strong>
            <span>来源</span><strong>Cloudflare D1 同步</strong>
            <span>提供方 / 模型</span><strong>OpenAI-compatible</strong>
          </div>
        </div>
      </header>
      <section id="assistant-messages" class="assistant-messages" aria-live="polite">
        <div class="chat-empty-state">
          <strong>开始新对话</strong>
          <span>点击「+ 新对话」开始</span>
        </div>
      </section>
      <form id="assistant-form" class="assistant-form">
        <div class="chat-composer__controls">
          <label>Agent
            <select disabled>
              <option>Wiki Web 助手 · gpt-5-mini</option>
            </select>
          </label>
          <div class="chat-composer__scope">
            <button type="button" class="is-active">全库</button>
            <button type="button">外网</button>
            <button type="button">两者</button>
          </div>
        </div>
        <textarea id="assistant-input" rows="4" placeholder="输入消息..."></textarea>
        <button type="submit">发送</button>
      </form>
    </section>
  </main>
  <script src="./assets/assistant.js"></script>
</body>
</html>`, "utf8");
}

function renderNav(currentPage) {
  const groups = new Map();
  for (const page of pages) {
    const dir = path.posix.dirname(page.sourcePath);
    const group = dir === "." ? "首页" : dir;
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(page);
  }

  return [...groups.entries()]
    .map(([group, items]) => {
      const links = items
        .sort((a, b) => a.title.localeCompare(b.title, "zh-CN"))
        .map((page) => {
          const active = page.sourcePath === currentPage.sourcePath ? " active" : "";
          return `<a class="tree-link${active}" href="${pageHref(currentPage, page)}">${escapeHtml(page.title)}</a>`;
        })
        .join("");
      return `<section class="tree-group"><h2>${escapeHtml(group)}</h2>${links}</section>`;
    })
    .join("");
}

function resolveWikiLink(target) {
  const normalized = target.replace(/\\/g, "/").replace(/\.md$/i, "");
  return pagesByPath.get(normalized) ?? pagesByPath.get(`${normalized}.md`) ?? pagesByStem.get(normalized) ?? null;
}

function pageHref(fromPage, toPage, anchor = "") {
  const fromDir = path.posix.dirname(fromPage.outPath);
  let href = path.posix.relative(fromDir === "." ? "" : fromDir, toPage.outPath);
  if (!href.startsWith(".")) href = `./${href}`;
  return encodeUriPath(href) + (anchor ? `#${encodeURIComponent(anchor)}` : "");
}

function relativeAsset(fromPage, assetPath) {
  const fromDir = path.posix.dirname(fromPage.outPath);
  let href = path.posix.relative(fromDir === "." ? "" : fromDir, assetPath);
  if (!href.startsWith(".")) href = `./${href}`;
  return href;
}

function homePage() {
  return pagesByPath.get("index.md") ?? pages[0];
}

function copyStaticWikiAssets() {
  for (const file of wikiFiles) {
    if (/\.md$/i.test(file)) continue;
    const rel = path.relative(wikiRoot, file);
    const target = path.join(outRoot, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(file, target);
  }
}

function writeStaticAssets() {
  const assetDir = path.join(outRoot, "assets");
  fs.mkdirSync(assetDir, { recursive: true });
  fs.writeFileSync(path.join(assetDir, "wiki.css"), css(), "utf8");
  fs.writeFileSync(path.join(assetDir, "wiki.js"), js(), "utf8");
  fs.writeFileSync(path.join(assetDir, "assistant.js"), assistantJs(), "utf8");
  fs.writeFileSync(path.join(assetDir, "wiki-search.json"), JSON.stringify(searchIndex(), null, 2), "utf8");
}

function css() {
  return `:root {
  color-scheme: light;
  font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  color: #172033;
  background: #f5f6f8;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  min-height: 100vh;
  display: grid;
  grid-template-columns: minmax(240px, 300px) minmax(0, 1fr);
}
a { color: #2563eb; text-decoration: none; }
a:hover { text-decoration: underline; }
.assistant-link {
  position: fixed;
  top: 16px;
  right: 18px;
  z-index: 20;
  display: inline-flex;
  align-items: center;
  height: 34px;
  padding: 0 12px;
  border: 1px solid #c7d2fe;
  border-radius: 4px;
  background: #eef2ff;
  color: #1d4ed8;
  font-size: 14px;
  font-weight: 600;
}
.assistant-link:hover {
  background: #e0e7ff;
  text-decoration: none;
}
.sidebar {
  position: sticky;
  top: 0;
  height: 100vh;
  overflow: auto;
  border-right: 1px solid #d9dee8;
  background: #eef1f5;
  padding: 18px 14px;
}
.brand {
  font-weight: 700;
  font-size: 18px;
  margin-bottom: 18px;
}
.brand a { color: #172033; }
.search-label {
  display: block;
  margin: 0 0 6px;
  font-size: 12px;
  color: #6b7280;
}
.search-input {
  width: 100%;
  height: 38px;
  border: 1px solid #d2d7e1;
  border-radius: 4px;
  padding: 0 10px;
  background: #fff;
  color: #172033;
}
.search-results {
  margin-top: 8px;
  border: 1px solid #d2d7e1;
  background: #fff;
}
.search-result {
  display: block;
  padding: 9px 10px;
  border-bottom: 1px solid #eceff4;
}
.search-result:last-child { border-bottom: 0; }
.search-result strong { display: block; color: #172033; font-size: 13px; }
.search-result span { display: block; color: #6b7280; font-size: 12px; margin-top: 3px; }
.tree { margin-top: 18px; }
.tree-group { margin-bottom: 18px; }
.tree-group h2 {
  margin: 0 0 6px;
  font-size: 12px;
  font-weight: 700;
  color: #6b7280;
  text-transform: uppercase;
  letter-spacing: .04em;
}
.tree-link {
  display: block;
  padding: 6px 8px;
  border-radius: 4px;
  color: #374151;
  font-size: 13px;
  line-height: 1.35;
}
.tree-link:hover,
.tree-link.active {
  background: #dfe8f7;
  color: #1d4ed8;
  text-decoration: none;
}
.content {
  min-width: 0;
  max-width: 980px;
  width: 100%;
  margin: 0 auto;
  padding: 32px 28px 80px;
  background: #fff;
}
.page-path {
  margin-bottom: 22px;
  color: #7b8494;
  font-size: 13px;
  border-bottom: 1px solid #e5e7eb;
  padding-bottom: 14px;
}
.wiki-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin: -10px 0 18px;
}
.wiki-action {
  display: inline-flex;
  align-items: center;
  min-height: 32px;
  padding: 0 11px;
  border: 1px solid #cbd5e1;
  border-radius: 4px;
  background: #fff;
  color: #1f2937;
  font: inherit;
  cursor: pointer;
}
.wiki-action:hover {
  border-color: #93c5fd;
  color: #1d4ed8;
  text-decoration: none;
}
.markdown {
  line-height: 1.72;
  font-size: 16px;
}
.markdown h1,
.markdown h2,
.markdown h3 {
  line-height: 1.25;
  color: #111827;
}
.markdown h1 { font-size: 32px; margin: 0 0 24px; }
.markdown h2 { font-size: 23px; margin-top: 36px; padding-bottom: 6px; border-bottom: 1px solid #e5e7eb; }
.markdown h3 { font-size: 18px; margin-top: 28px; }
.markdown p,
.markdown ul,
.markdown ol,
.markdown blockquote,
.markdown pre,
.markdown table { margin: 14px 0; }
.markdown code {
  padding: 2px 5px;
  border-radius: 3px;
  background: #f3f4f6;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: .92em;
}
.markdown pre {
  overflow: auto;
  padding: 14px;
  border: 1px solid #d9dee8;
  background: #f8fafc;
}
.markdown pre code { padding: 0; background: transparent; }
.markdown blockquote {
  border-left: 3px solid #cbd5e1;
  padding-left: 14px;
  color: #4b5563;
}
.markdown table {
  border-collapse: collapse;
  width: 100%;
}
.markdown th,
.markdown td {
  border: 1px solid #d9dee8;
  padding: 8px 10px;
}
.wikilink-dead { color: #9ca3af; }
.comments-panel {
  position: fixed;
  top: 0;
  right: 0;
  z-index: 30;
  width: min(420px, 100vw);
  height: 100vh;
  overflow: auto;
  border-left: 1px solid #d9dee8;
  background: #fff;
  padding: 16px;
  box-shadow: -10px 0 30px rgba(15, 23, 42, .08);
}
.comments-panel__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 12px;
  border-bottom: 1px solid #e5e7eb;
}
.comments-panel__header span,
.comments-panel__hint {
  display: block;
  color: #6b7280;
  font-size: 13px;
}
.comments-panel__header button,
.comments-panel__save,
.comment-card button {
  border: 1px solid #cbd5e1;
  border-radius: 4px;
  background: #fff;
  padding: 7px 10px;
  cursor: pointer;
}
.comments-panel textarea {
  width: 100%;
  margin: 10px 0;
  border: 1px solid #cbd5e1;
  border-radius: 4px;
  padding: 10px;
  font: inherit;
  resize: vertical;
}
.comments-panel__save {
  width: 100%;
  border-color: #2563eb;
  background: #2563eb;
  color: #fff;
  font-weight: 600;
}
.comment-card {
  margin-top: 12px;
  border: 1px solid #e5e7eb;
  border-radius: 4px;
  padding: 10px;
  background: #f8fafc;
}
.comment-card blockquote {
  margin: 0 0 8px;
  padding-left: 10px;
  border-left: 3px solid #93c5fd;
  color: #475569;
}
.comment-card p {
  margin: 0 0 10px;
  white-space: pre-wrap;
}
.comment-card__actions {
  display: flex;
  gap: 8px;
}
.comment-card.is-resolved {
  opacity: .62;
}
.assistant-page {
  display: block;
  min-height: 100vh;
  background: #f5f6f8;
}
.back-link {
  color: #4b5563;
  font-size: 14px;
}
.assistant-workspace {
  min-height: 100vh;
  display: grid;
  grid-template-columns: 280px 300px minmax(0, 1fr);
  gap: 12px;
  padding: 28px;
}
.assistant-file-tree,
.assistant-conversations,
.assistant-thread {
  border: 1px solid #d9dee8;
  border-radius: 8px;
  background: #fff;
}
.assistant-file-tree,
.assistant-conversations {
  min-height: calc(100vh - 56px);
  padding: 16px;
  overflow: auto;
}
.assistant-file-tree__tabs {
  display: inline-flex;
  margin: 14px 0;
  padding: 3px;
  border-radius: 8px;
  background: #f1f5f9;
}
.assistant-file-tree__tabs button,
.chat-composer__scope button {
  border: 0;
  border-radius: 6px;
  background: transparent;
  padding: 7px 14px;
  font: inherit;
  cursor: pointer;
}
.assistant-file-tree__tabs button.is-active,
.chat-composer__scope button.is-active {
  background: #fff;
  color: #4f46e5;
}
.assistant-page-list {
  margin-top: 14px;
}
.assistant-page-list a {
  display: block;
  padding: 7px 8px;
  border-radius: 4px;
  color: #4b5563;
}
.assistant-page-list a:hover {
  background: #eef2ff;
  text-decoration: none;
}
.assistant-conversations .btn-primary {
  width: 100%;
  min-height: 46px;
  border: 0;
  border-radius: 8px;
  background: #6d5dfc;
  color: #fff;
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}
.assistant-conversation-list {
  margin-top: 18px;
}
.assistant-conversation-item {
  display: block;
  width: 100%;
  margin-bottom: 8px;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  background: #fff;
  padding: 10px;
  text-align: left;
  cursor: pointer;
}
.assistant-conversation-item.is-active {
  border-color: #8b5cf6;
  background: #f5f3ff;
}
.assistant-conversation-item strong,
.assistant-conversation-item span {
  display: block;
}
.assistant-conversation-item span {
  margin-top: 4px;
  color: #6b7280;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.assistant-thread {
  min-height: calc(100vh - 56px);
  display: grid;
  grid-template-rows: auto 1fr auto;
  overflow: hidden;
}
.assistant-thread__header {
  padding: 28px 32px;
  border-bottom: 1px solid #e5e7eb;
}
.assistant-thread__header h1 {
  margin: 8px 0 14px;
}
.assistant-runtime-card {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 8px 12px;
  width: fit-content;
  max-width: 560px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 12px;
}
.assistant-runtime-card span {
  color: #6b7280;
}
.assistant-messages {
  overflow: auto;
  background: #fff;
  padding: 32px;
}
.assistant-message {
  max-width: 820px;
  margin: 0 0 12px;
  padding: 10px 12px;
  border: 1px solid #e5e7eb;
  border-radius: 4px;
  white-space: pre-wrap;
  line-height: 1.65;
}
.assistant-message-user {
  margin-left: auto;
  background: #eef2ff;
  border-color: #c7d2fe;
}
.assistant-message-assistant {
  background: #f8fafc;
}
.assistant-form {
  padding: 20px 32px 28px;
  border-top: 1px solid #e5e7eb;
}
.chat-composer__controls {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}
.chat-composer__controls label {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.chat-composer__controls select {
  min-width: 260px;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  padding: 8px 10px;
}
.chat-composer__scope {
  display: inline-flex;
  gap: 8px;
}
.assistant-form textarea {
  width: 100%;
  resize: vertical;
  border: 1px solid #cbd5e1;
  border-radius: 4px;
  padding: 10px 12px;
  font: inherit;
  line-height: 1.5;
}
.assistant-form > button[type="submit"] {
  float: right;
  width: 92px;
  height: 42px;
  margin-top: 12px;
  border: 1px solid #1d4ed8;
  border-radius: 4px;
  background: #2563eb;
  color: #fff;
  font: inherit;
  font-weight: 600;
}
.assistant-form > button[type="submit"]:disabled {
  opacity: .55;
  cursor: not-allowed;
}
.chat-empty-state {
  display: grid;
  place-items: center;
  min-height: 260px;
  color: #6b7280;
  text-align: center;
}
.chat-empty-state strong,
.chat-empty-state span {
  display: block;
}
@media (max-width: 760px) {
  body { display: block; }
  .sidebar {
    position: static;
    height: auto;
    max-height: 45vh;
    border-right: 0;
    border-bottom: 1px solid #d9dee8;
  }
  .content { padding: 24px 18px 64px; }
  .markdown h1 { font-size: 26px; }
  .assistant-link {
    top: 10px;
    right: 10px;
  }
  .assistant-workspace {
    display: block;
    padding: 10px;
  }
  .assistant-file-tree,
  .assistant-conversations,
  .assistant-thread {
    min-height: auto;
    margin-bottom: 10px;
  }
  .chat-composer__controls,
  .assistant-form {
    grid-template-columns: 1fr;
    display: grid;
  }
  .assistant-form > button[type="submit"] {
    width: 100%;
    height: 42px;
  }
}`;
}

function js() {
  return `const input = document.getElementById("wiki-search");
const box = document.getElementById("search-results");
const pages = window.__WIKI_SEARCH__ || [];
const pagePath = document.body?.dataset?.pagePath || "";
const commentsPanel = document.querySelector("[data-comments-panel]");
const commentsToggle = document.querySelector("[data-comments-toggle]");
const commentsClose = document.querySelector("[data-comments-close]");
const commentsInput = document.querySelector("[data-comment-input]");
const commentsSave = document.querySelector("[data-comment-save]");
const commentsList = document.querySelector("[data-comments-list]");
const commentsCount = document.querySelector("[data-comments-count]");
let comments = [];

input?.addEventListener("input", () => {
  const query = input.value.trim().toLowerCase();
  if (!query) {
    box.hidden = true;
    box.innerHTML = "";
    return;
  }
  const matches = pages
    .filter((page) => [page.title, page.path, page.excerpt].join(" ").toLowerCase().includes(query))
    .slice(0, 10);
  box.innerHTML = matches
    .map((page) => '<a class="search-result" href="' + page.href + '"><strong>' + escapeHtml(page.title) + '</strong><span>' + escapeHtml(page.path) + '</span></a>')
    .join("");
  box.hidden = matches.length === 0;
});

commentsToggle?.addEventListener("click", () => {
  if (!commentsPanel) return;
  commentsPanel.hidden = false;
  loadComments();
});

commentsClose?.addEventListener("click", () => {
  if (commentsPanel) commentsPanel.hidden = true;
});

commentsSave?.addEventListener("click", async () => {
  const comment = commentsInput?.value.trim() || "";
  if (!pagePath || !comment) return;
  const selected = window.getSelection?.().toString().trim() || "";
  const quote = selected || document.querySelector(".markdown h1")?.textContent?.trim() || pagePath;
  commentsSave.disabled = true;
  try {
    const response = await fetch("/api/comments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pagePath, quote, comment, source: "web" }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.success) throw new Error(data.error || "保存评论失败");
    commentsInput.value = "";
    await loadComments();
  } catch (error) {
    alert(error instanceof Error ? error.message : "保存评论失败");
  } finally {
    commentsSave.disabled = false;
  }
});

commentsList?.addEventListener("click", async (event) => {
  const target = event.target.closest("button");
  if (!target) return;
  const id = target.dataset.commentResolve || target.dataset.commentDelete;
  if (!id) return;
  try {
    if (target.dataset.commentDelete) {
      await fetch("/api/comments/" + encodeURIComponent(id), { method: "DELETE" });
    } else {
      const existing = comments.find((item) => item.id === id);
      await fetch("/api/comments/" + encodeURIComponent(id), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resolved: !existing?.resolved }),
      });
    }
    await loadComments();
  } catch {
    alert("更新评论失败");
  }
});

async function loadComments() {
  if (!pagePath || !commentsList) return;
  try {
    const response = await fetch("/api/comments?pagePath=" + encodeURIComponent(pagePath));
    const payload = await response.json().catch(() => ({}));
    comments = payload.success && Array.isArray(payload.data) ? payload.data : [];
  } catch {
    comments = [];
  }
  renderComments();
}

function renderComments() {
  if (commentsCount) commentsCount.textContent = comments.length + " 条";
  if (!commentsList) return;
  if (!comments.length) {
    commentsList.innerHTML = '<p class="comments-panel__hint">暂无评论</p>';
    return;
  }
  commentsList.innerHTML = comments.map((item) =>
    '<article class="comment-card' + (item.resolved ? ' is-resolved' : '') + '">' +
      '<blockquote>' + escapeHtml(item.quote || pagePath) + '</blockquote>' +
      '<p>' + escapeHtml(item.comment || '') + '</p>' +
      '<div class="comment-card__actions">' +
        '<button type="button" data-comment-resolve="' + escapeHtml(item.id) + '">' + (item.resolved ? '重新打开' : '解决') + '</button>' +
        '<button type="button" data-comment-delete="' + escapeHtml(item.id) + '">删除</button>' +
      '</div>' +
    '</article>'
  ).join("");
}

if (commentsPanel && !commentsPanel.hidden) loadComments();

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}`;
}

function assistantJs() {
  return `const form = document.getElementById("assistant-form");
const input = document.getElementById("assistant-input");
const messages = document.getElementById("assistant-messages");
const conversationList = document.getElementById("chat-conversation-list");
const newButton = document.getElementById("chat-new-conversation");
const threadTitle = document.getElementById("chat-thread-title");
const pageList = document.getElementById("assistant-page-list");
const pageSearch = document.getElementById("assistant-page-search");
let wikiIndex = [];
let conversations = [];
let currentConversation = null;

Promise.all([loadWikiIndex(), loadConversations()]).then(() => {
  renderPageList("");
  const params = new URLSearchParams(window.location.search);
  const page = params.get("page");
  if (page) input.value = "请结合 " + page + " 这篇 Wiki 页面回答：";
});

newButton?.addEventListener("click", async () => {
  const conversation = await createConversation();
  currentConversation = conversation;
  await loadConversations(conversation.id);
  renderThread(conversation);
});

conversationList?.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-conversation-id]");
  if (!button) return;
  const id = button.dataset.conversationId;
  const response = await fetch("/api/chat/" + encodeURIComponent(id));
  const payload = await response.json();
  if (payload.success) {
    currentConversation = payload.data;
    renderConversationList(id);
    renderThread(currentConversation);
  }
});

pageSearch?.addEventListener("input", () => {
  renderPageList(pageSearch.value.trim());
});

form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const question = input.value.trim();
  if (!question) return;
  if (!currentConversation) {
    currentConversation = await createConversation();
  }
  input.value = "";
  const localView = {
    ...currentConversation,
    messages: [
      ...(currentConversation.messages || []),
      { id: "pending-user", role: "user", content: question, createdAt: new Date().toISOString() },
      { id: "pending-assistant", role: "assistant", content: "正在检索 Wiki 并生成回答...", createdAt: new Date().toISOString() },
    ],
  };
  renderThread(localView);
  setBusy(true);
  try {
    const contexts = findRelevantPages(question);
    const response = await fetch("/api/chat/" + encodeURIComponent(currentConversation.id) + "/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: question, contexts }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.success) {
      throw new Error(data.error || "AI 助手请求失败");
    }
    currentConversation = data.data;
    await loadConversations(currentConversation.id);
    renderThread(currentConversation);
  } catch (error) {
    appendMessage("assistant", error instanceof Error ? error.message : "AI 助手请求失败");
  } finally {
    setBusy(false);
  }
});

async function loadWikiIndex() {
  try {
    const response = await fetch("./assets/wiki-search.json");
    const data = response.ok ? await response.json() : [];
    wikiIndex = Array.isArray(data) ? data : [];
  } catch {
    wikiIndex = [];
  }
}

async function loadConversations(selectedId = null) {
  const response = await fetch("/api/chat");
  const payload = await response.json().catch(() => ({}));
  conversations = payload.success && Array.isArray(payload.data) ? payload.data : [];
  renderConversationList(selectedId || currentConversation?.id || null);
}

async function createConversation() {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "新对话", searchScope: "local" }),
  });
  const payload = await response.json();
  if (!payload.success) throw new Error(payload.error || "创建对话失败");
  return payload.data;
}

function renderConversationList(selectedId) {
  if (!conversationList) return;
  if (!conversations.length) {
    conversationList.innerHTML = '<p class="muted">暂无对话</p>';
    return;
  }
  conversationList.innerHTML = conversations.map((item) => '<button type="button" class="assistant-conversation-item' + (item.id === selectedId ? ' is-active' : '') + '" data-conversation-id="' + escapeHtml(item.id) + '"><strong>' + escapeHtml(item.title || "新对话") + '</strong><span>' + escapeHtml(item.latestMessage || "尚无消息") + '</span></button>').join("");
}

function renderThread(conversation) {
  if (!conversation) return;
  threadTitle.textContent = conversation.title || "新对话";
  const items = Array.isArray(conversation.messages) ? conversation.messages : [];
  if (!items.length) {
    messages.innerHTML = '<div class="chat-empty-state"><strong>开始新对话</strong><span>输入第一条消息开始对话</span></div>';
    return;
  }
  messages.innerHTML = items.map((message) => '<article class="assistant-message assistant-message-' + escapeHtml(message.role) + '"><div>' + escapeHtml(message.content) + '</div></article>').join("");
  messages.scrollTop = messages.scrollHeight;
}

function renderPageList(query) {
  if (!pageList) return;
  const q = query.toLowerCase();
  const items = wikiIndex.filter((page) => !q || [page.title, page.path, page.excerpt].join(" ").toLowerCase().includes(q)).slice(0, 80);
  pageList.innerHTML = items.map((page) => '<a href="./' + page.href + '">' + escapeHtml(page.title) + '</a>').join("");
}

function findRelevantPages(question) {
  const terms = question
    .toLowerCase()
    .split(/\\s+/)
    .map((term) => term.trim())
    .filter(Boolean);
  return wikiIndex
    .map((page) => ({ page, score: scorePage(page, terms, question) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map((item) => ({
      title: item.page.title,
      path: item.page.path,
      excerpt: item.page.excerpt,
      text: String(item.page.text || "").slice(0, 1800),
    }));
}

function scorePage(page, terms, question) {
  const haystack = [page.title, page.path, page.excerpt, page.text].join(" ").toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (!term) continue;
    if (String(page.title || "").toLowerCase().includes(term)) score += 8;
    if (String(page.path || "").toLowerCase().includes(term)) score += 4;
    if (haystack.includes(term)) score += 1;
  }
  if (haystack.includes(question.toLowerCase())) score += 10;
  return score;
}

function appendMessage(role, text) {
  const node = document.createElement("div");
  node.className = "assistant-message assistant-message-" + role;
  node.textContent = text;
  messages.appendChild(node);
  messages.scrollTop = messages.scrollHeight;
  return node;
}

function setBusy(busy) {
  const button = form?.querySelector("button[type=submit]");
  if (button) button.disabled = busy;
  if (input) input.disabled = busy;
}`;
}

function toPosix(value) {
  return value.split(path.sep).join("/");
}

function fromPosix(value) {
  return value.split("/").join(path.sep);
}

function encodeUriPath(value) {
  return value
    .split("/")
    .map((part) => (part === "." || part === ".." ? part : encodeURIComponent(part)))
    .join("/");
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
