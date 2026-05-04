/**
 * RSS import workspace for the settings data-import section.
 *
 * The module keeps the RSS collection experience separate from the large
 * settings page file. It renders a focused work surface for pasting a feed,
 * RSSHub route, or keyword, then lets the user inspect subscriptions and
 * candidate entries before the backend ingestion flow is connected.
 */

import { renderIcon } from "../../components/icon.js";

type RssInputKind = "RSS 订阅源" | "RSSHub 路由" | "关键词";

interface RssFeedPreview {
  readonly title: string;
  readonly host: string;
  readonly cadence: string;
  readonly status: string;
  readonly count: string;
}

interface RssArticlePreview {
  readonly title: string;
  readonly source: string;
  readonly age: string;
  readonly summary: string;
  readonly tag: string;
}

const RSS_FEED_PREVIEWS: readonly RssFeedPreview[] = [
  { title: "技术博客精选", host: "example.com/feed.xml", cadence: "每 6 小时", status: "正常", count: "24" },
  { title: "RSSHub 路由", host: "/github/trending/daily/typescript", cadence: "每天", status: "待确认", count: "8" },
  { title: "产品更新", host: "updates.example.com/rss", cadence: "每 12 小时", status: "正常", count: "16" },
];

const RSS_ARTICLE_PREVIEWS: readonly RssArticlePreview[] = [
  {
    title: "把长文收录为可追溯知识卡片",
    source: "技术博客精选",
    age: "12 分钟前",
    summary: "保留原文链接、作者、发布时间和摘要，进入审查页后再决定是否写入 Wiki。",
    tag: "待审查",
  },
  {
    title: "RSSHub 路由新增筛选参数",
    source: "RSSHub 路由",
    age: "48 分钟前",
    summary: "对列表类来源先做轻量预览，避免一次性收录过多低价值条目。",
    tag: "新条目",
  },
  {
    title: "本周产品更新摘要",
    source: "产品更新",
    age: "今天 09:30",
    summary: "适合直接进入收录队列，并在编译时生成来源、标签和时间线索引。",
    tag: "可收录",
  },
];

/** Render the hidden RSS import workspace. */
export function renderRssImportPanel(): string {
  return `
    <section class="settings-rss-import" data-rss-import-page hidden>
      ${renderRssHeader()}
      <div class="settings-rss-import__workspace">
        ${renderRssConsole()}
        ${renderRssPipeline()}
      </div>
      <div class="settings-rss-import__grid">
        ${renderRssFeedPanel()}
        ${renderRssArticlePanel()}
      </div>
    </section>
  `;
}

/** Bind local UI behavior for the RSS import workspace. */
export function bindRssImportPanel(root: HTMLElement): void {
  root.querySelector<HTMLButtonElement>("[data-rss-import-back]")?.addEventListener("click", () => {
    closeRssImportPanel(root);
  });
  root.querySelector<HTMLInputElement>("[data-rss-import-input]")?.addEventListener("input", () => {
    updateRssInputPreview(root);
  });
  root.querySelector<HTMLButtonElement>("[data-rss-import-submit]")?.addEventListener("click", () => {
    submitRssInputPreview(root);
  });
  bindRssModeControls(root);
  bindRssQuickActions(root);
}

function renderRssHeader(): string {
  return `
    <header class="settings-rss-import__header">
      <button type="button" class="icon-btn settings-rss-import__back" data-rss-import-back aria-label="返回数据导入">
        ${renderIcon("chevron-left", { size: 22 })}
      </button>
      <div class="settings-rss-import__title">
        <div class="eyebrow">RSS IMPORT</div>
        <h1>RSS 收录</h1>
        <p>把订阅源、RSSHub 路由和列表页更新收进统一审查队列。</p>
      </div>
      <div class="settings-rss-import__stats" aria-label="RSS 收录状态">
        ${renderRssStat("订阅源", "3")}
        ${renderRssStat("待审查", "18")}
        ${renderRssStat("本日新增", "7")}
      </div>
    </header>
  `;
}

function renderRssStat(label: string, value: string): string {
  return `<span><strong>${value}</strong><small>${label}</small></span>`;
}

function renderRssConsole(): string {
  return `
    <section class="settings-rss-import__console">
      <div class="settings-rss-import__panel-head">
        <div>${renderIcon("rss", { size: 22 })}<strong>发现</strong></div>
        <span data-rss-detected-kind>尚未识别</span>
      </div>
      <label class="settings-rss-import__input">
        <span>订阅源、RSSHub 路由或关键词</span>
        <input data-rss-import-input type="text" placeholder="https://example.com/feed.xml" />
      </label>
      ${renderRssModes()}
      <div class="settings-rss-import__actions">
        <button type="button" class="btn btn-primary" data-rss-import-submit>${renderIcon("search", { size: 17 })}解析预览</button>
        <button type="button" class="btn btn-secondary" data-rss-quick-action="收录选中">${renderIcon("archive", { size: 17 })}收录选中</button>
      </div>
      <p class="settings-rss-import__status" data-rss-import-status>等待输入 RSS 订阅源。</p>
      ${renderRssActionGrid()}
    </section>
  `;
}

function renderRssModes(): string {
  return `
    <div class="settings-rss-import__modes" role="tablist" aria-label="RSS 输入模式">
      <button type="button" data-rss-mode="订阅源" aria-pressed="true">订阅源</button>
      <button type="button" data-rss-mode="列表" aria-pressed="false">列表</button>
    </div>
  `;
}

function renderRssActionGrid(): string {
  const actions: ReadonlyArray<readonly [string, string]> = [
    ["导入 OPML", "批量加入订阅源"],
    ["HTML 转 RSS", "把列表页变成订阅"],
    ["收件箱", "先暂存再审查"],
    ["关注用户", "按作者持续收录"],
  ];
  return `<div class="settings-rss-import__quick">${actions.map(renderRssQuickAction).join("")}</div>`;
}

function renderRssQuickAction(action: readonly [string, string]): string {
  const [title, detail] = action;
  return `
    <button type="button" data-rss-quick-action="${title}">
      <strong>${title}</strong>
      <span>${detail}</span>
    </button>
  `;
}

function renderRssPipeline(): string {
  return `
    <aside class="settings-rss-import__pipeline" aria-label="RSS 收录流程">
      <h2>收录流程</h2>
      ${renderRssPipelineStep("1", "识别来源", "判断是标准 RSS、RSSHub 路由还是关键词。", true)}
      ${renderRssPipelineStep("2", "解析预览", "先展示标题、摘要、发布时间和原文链接。", false)}
      ${renderRssPipelineStep("3", "进入审查", "待审查内容不会直接写入 Wiki。", false)}
      ${renderRssPipelineStep("4", "编译成文", "确认后进入同步和编译流程。", false)}
    </aside>
  `;
}

function renderRssPipelineStep(index: string, title: string, detail: string, active: boolean): string {
  return `
    <div class="settings-rss-import__step${active ? " is-active" : ""}">
      <span>${index}</span>
      <div><strong>${title}</strong><p>${detail}</p></div>
    </div>
  `;
}

function renderRssFeedPanel(): string {
  return `
    <section class="settings-rss-import__feeds">
      <div class="settings-rss-import__section-head">
        <h2>订阅源</h2>
        <button type="button" class="btn btn-secondary btn-inline" data-rss-quick-action="刷新订阅">${renderIcon("refresh-cw", { size: 16 })}刷新</button>
      </div>
      <div class="settings-rss-import__feed-list">
        ${RSS_FEED_PREVIEWS.map(renderRssFeedCard).join("")}
        ${renderRssDraftFeed()}
      </div>
    </section>
  `;
}

function renderRssFeedCard(feed: RssFeedPreview): string {
  return `
    <article class="settings-rss-import__feed-card">
      <div><strong>${feed.title}</strong><span>${feed.host}</span></div>
      <dl><dt>频率</dt><dd>${feed.cadence}</dd><dt>状态</dt><dd>${feed.status}</dd><dt>条目</dt><dd>${feed.count}</dd></dl>
    </article>
  `;
}

function renderRssDraftFeed(): string {
  return `
    <article class="settings-rss-import__feed-card settings-rss-import__feed-card--draft" data-rss-draft-feed hidden>
      <div><strong data-rss-draft-title>新的订阅源</strong><span data-rss-draft-url></span></div>
      <dl><dt>频率</dt><dd>待设置</dd><dt>状态</dt><dd>预览中</dd><dt>条目</dt><dd>--</dd></dl>
    </article>
  `;
}

function renderRssArticlePanel(): string {
  return `
    <section class="settings-rss-import__articles">
      <div class="settings-rss-import__section-head">
        <h2>待收录内容</h2>
        <button type="button" class="btn btn-secondary btn-inline" data-rss-quick-action="切换列表">${renderIcon("list-checks", { size: 16 })}列表</button>
      </div>
      <div class="settings-rss-import__article-list">
        ${RSS_ARTICLE_PREVIEWS.map(renderRssArticleRow).join("")}
      </div>
    </section>
  `;
}

function renderRssArticleRow(article: RssArticlePreview): string {
  return `
    <article class="settings-rss-import__article-row">
      <div><strong>${article.title}</strong><span>${article.source} · ${article.age}</span></div>
      <p>${article.summary}</p>
      <em>${article.tag}</em>
    </article>
  `;
}

function bindRssModeControls(root: HTMLElement): void {
  root.querySelectorAll<HTMLButtonElement>("[data-rss-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      root.querySelectorAll<HTMLButtonElement>("[data-rss-mode]").forEach((item) => {
        item.setAttribute("aria-pressed", String(item === button));
      });
      setRssStatus(root, `已切换到${button.dataset.rssMode ?? "订阅源"}模式。`);
    });
  });
}

function bindRssQuickActions(root: HTMLElement): void {
  root.querySelectorAll<HTMLButtonElement>("[data-rss-quick-action]").forEach((button) => {
    button.addEventListener("click", () => {
      setRssStatus(root, `${button.dataset.rssQuickAction ?? "该操作"}已加入 RSS 收录工作台。`);
    });
  });
}

function updateRssInputPreview(root: HTMLElement): void {
  const value = readRssInput(root);
  const kind = value ? detectRssInputKind(value) : "尚未识别";
  setElementText(root, "[data-rss-detected-kind]", kind);
  setRssStatus(root, value ? `已识别为${kind}，可以解析预览。` : "等待输入 RSS 订阅源。");
}

function submitRssInputPreview(root: HTMLElement): void {
  const value = readRssInput(root);
  if (!value) {
    setRssStatus(root, "请先输入订阅源、RSSHub 路由或关键词。");
    return;
  }
  const kind = detectRssInputKind(value);
  const draftFeed = root.querySelector<HTMLElement>("[data-rss-draft-feed]");
  if (draftFeed) draftFeed.hidden = false;
  setElementText(root, "[data-rss-draft-title]", kind);
  setElementText(root, "[data-rss-draft-url]", value);
  setRssStatus(root, `已生成${kind}预览，确认后进入待收录内容列表。`);
}

function closeRssImportPanel(root: HTMLElement): void {
  setRssPanelOpen(root, false);
}

function setRssPanelOpen(root: HTMLElement, open: boolean): void {
  root.querySelectorAll<HTMLElement>("[data-import-home]").forEach((section) => {
    section.hidden = open;
  });
  const panel = root.querySelector<HTMLElement>("[data-rss-import-page]");
  if (panel) panel.hidden = !open;
}

function readRssInput(root: HTMLElement): string {
  return root.querySelector<HTMLInputElement>("[data-rss-import-input]")?.value.trim() ?? "";
}

function detectRssInputKind(value: string): RssInputKind {
  if (value.startsWith("/") || value.toLowerCase().includes("rsshub")) {
    return "RSSHub 路由";
  }
  if (/^https?:\/\//i.test(value)) {
    return "RSS 订阅源";
  }
  return "关键词";
}

function setRssStatus(root: HTMLElement, message: string): void {
  setElementText(root, "[data-rss-import-status]", message);
}

function setElementText(root: HTMLElement, selector: string, text: string): void {
  const element = root.querySelector<HTMLElement>(selector);
  if (element) element.textContent = text;
}
