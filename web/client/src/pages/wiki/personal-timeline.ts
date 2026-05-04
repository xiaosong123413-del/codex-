/**
 * Enhances the personal timeline wiki page with a two-mode fact layout.
 */

import { openManualSupplementDialog } from "./personal-timeline-manual.js";
import { enhancePendingTimelineFacts } from "./personal-timeline-pending.js";

const PERSONAL_TIMELINE_PATH = "wiki/个人信息档案/个人时间线.md";
const HISTORY_SOURCE_LABEL = "历史回忆";
const HISTORY_SOURCE_PATH = "wiki/个人信息档案/历史回忆.md";
const DATE_SECTION_TITLES = ["按日", "按月", "按年", "按十年"];
const SOURCE_ENTRY_STORAGE_KEY = "llmWiki.personalTimelineSourceEntries";
const SOURCE_FILTERS: SourceFilter[] = [
  { label: "日记", aliases: ["日记", "闪念日记", "原始记录"], entries: ["#/flash-diary"] },
  { label: HISTORY_SOURCE_LABEL, aliases: ["历史回忆", "回忆", "补录"], entries: [HISTORY_SOURCE_PATH] },
  { label: "聊天记录", aliases: ["聊天记录", "聊天"], entries: [] },
];

type DateGranularity = "day" | "month" | "year" | "decade";
type SourceRefreshState = "idle" | "running" | "done" | "failed";

interface TimelineSection {
  title: string;
  html: string;
  rows: string[][];
  kind: "date" | "theme";
  filter: string;
}

interface SourceFilter {
  label: string;
  aliases: string[];
  entries: string[];
}

interface SourceRefreshPayload {
  status: "missing-entry" | "no-increment" | "written";
  message: string;
  changedFiles: number;
  digest?: string;
}

export function enhancePersonalTimelinePage(article: HTMLElement, path: string): void {
  if (!isPersonalTimelinePath(path)) return;
  const sections = collectTimelineSections(article);
  moveOverviewToEnd(article);
  const anchor = findRecordPrinciplesEnd(article);
  if (!anchor || sections.date.length + sections.theme.length === 0) return;
  removeSourceSections(article, [...sections.date, ...sections.theme]);
  anchor.after(renderTimelineDashboard(sections.date, sections.theme));
  enhancePendingTimelineFacts(article);
  bindTimelineControls(article);
  article.classList.add("personal-timeline-page");
}

function collectTimelineSections(article: HTMLElement): { date: TimelineSection[]; theme: TimelineSection[] } {
  return {
    date: DATE_SECTION_TITLES.map((title) => readDateSection(article, title)).filter(isTimelineSection),
    theme: readThemeSections(article),
  };
}

function readDateSection(article: HTMLElement, title: string): TimelineSection | null {
  const heading = findHeading(article, title);
  if (!heading) return null;
  const nodes = collectSectionNodes(heading);
  return {
    title,
    html: nodes.map((node) => node.outerHTML).join(""),
    rows: readTableRows(nodes),
    kind: "date",
    filter: dateGranularityForTitle(title),
  };
}

function readThemeSections(article: HTMLElement): TimelineSection[] {
  const heading = findHeading(article, "按领域");
  if (!heading) return [];
  return collectThemeGroups(heading);
}

function findHeading(article: HTMLElement, title: string): HTMLHeadingElement | null {
  return Array.from(article.querySelectorAll<HTMLHeadingElement>("h2"))
    .find((heading) => normalizeHeadingText(heading) === title) ?? null;
}

function isPersonalTimelinePath(path: string): boolean {
  return path.replace(/\\/g, "/").endsWith(PERSONAL_TIMELINE_PATH);
}

function normalizeHeadingText(heading: HTMLHeadingElement): string {
  return (heading.textContent ?? "").replace(/^§\s*/, "").trim();
}

function collectSectionNodes(heading: HTMLHeadingElement): HTMLElement[] {
  const nodes: HTMLElement[] = [heading];
  let current = heading.nextElementSibling;
  while (current && current.tagName !== "H2") {
    nodes.push(current as HTMLElement);
    current = current.nextElementSibling;
  }
  return nodes;
}

function collectThemeGroups(heading: HTMLHeadingElement): TimelineSection[] {
  const groups: TimelineSection[] = [];
  let current = heading.nextElementSibling;
  while (current && current.tagName !== "H2") {
    if (current.tagName === "H3") {
      const groupNodes = collectThemeGroupNodes(current as HTMLHeadingElement);
      const title = normalizeHeadingText(current as HTMLHeadingElement);
      groups.push({
        title,
        html: groupNodes.map((node) => node.outerHTML).join(""),
        rows: readTableRows(groupNodes),
        kind: "theme",
        filter: title,
      });
      current = groupNodes.at(-1)?.nextElementSibling ?? null;
      continue;
    }
    current = current.nextElementSibling;
  }
  return groups;
}

function collectThemeGroupNodes(heading: HTMLHeadingElement): HTMLElement[] {
  const nodes: HTMLElement[] = [heading];
  let current = heading.nextElementSibling;
  while (current && current.tagName !== "H2" && current.tagName !== "H3") {
    nodes.push(current as HTMLElement);
    current = current.nextElementSibling;
  }
  return nodes;
}

function readTableRows(nodes: HTMLElement[]): string[][] {
  return nodes.flatMap((node) => Array.from(node.querySelectorAll("tbody tr")).map((row) => (
    Array.from(row.querySelectorAll("td")).map((cell) => cell.textContent?.trim() ?? "")
  )));
}

function isTimelineSection(section: TimelineSection | null): section is TimelineSection {
  return section !== null;
}

function moveOverviewToEnd(article: HTMLElement): void {
  const overview = findHeading(article, "总览");
  if (!overview) return;
  collectSectionNodes(overview).forEach((node) => article.appendChild(node));
}

function findRecordPrinciplesEnd(article: HTMLElement): HTMLElement | null {
  const heading = findHeading(article, "记录原则");
  if (!heading) return null;
  const nodes = collectSectionNodes(heading);
  return nodes.at(-1) ?? heading;
}

function removeSourceSections(article: HTMLElement, sections: TimelineSection[]): void {
  const titles = new Set([...sections.map((section) => section.title), "按领域"]);
  Array.from(article.querySelectorAll<HTMLHeadingElement>("h2")).forEach((heading) => {
    if (!titles.has(normalizeHeadingText(heading))) return;
    collectSectionNodes(heading).forEach((node) => node.remove());
  });
}

function renderTimelineDashboard(dateSections: TimelineSection[], themeSections: TimelineSection[]): HTMLElement {
  const dashboard = document.createElement("section");
  dashboard.className = "personal-timeline";
  dashboard.innerHTML = `
    <div class="personal-timeline__filters" aria-label="个人时间线筛选">
      <div class="personal-timeline__filter-group">
        <span>时间粒度</span>
        <div class="personal-timeline__button-row">
          ${renderDateFilterButtons(dateSections)}
        </div>
      </div>
      <div class="personal-timeline__filter-group personal-timeline__filter-group--themes">
        <span>领域筛选</span>
        <div class="personal-timeline__theme-scroll">
          ${renderThemeFilterButtons(themeSections)}
        </div>
      </div>
      <div class="personal-timeline__filter-group personal-timeline__filter-group--sources">
        <div class="personal-timeline__source-head">
          <span>输入来源</span>
          <button type="button" data-personal-timeline-source-refresh>刷新</button>
        </div>
        <div class="personal-timeline__source-scroll">
          ${renderSourceFilterButtons()}
        </div>
        <div class="personal-timeline__source-status" data-personal-timeline-source-status hidden></div>
      </div>
      <div class="personal-timeline__search-panel">
        <label>
          <span>搜索时间线</span>
          <input type="search" placeholder="搜索时间线" data-personal-timeline-search />
        </label>
      </div>
    </div>
    <div class="personal-timeline__source-modal" data-personal-timeline-source-editor hidden></div>
    ${renderTimelineView([...dateSections, ...themeSections])}
  `;
  return dashboard;
}

function renderDateFilterButtons(sections: TimelineSection[]): string {
  const available = new Set(sections.map((section) => section.filter));
  return [
    ["day", "日"],
    ["month", "月"],
    ["year", "年"],
    ["decade", "十年"],
  ].map(([filter, label]) => `
    <button type="button" data-personal-timeline-grain="${filter}" ${available.has(filter) ? "" : "disabled"}>
      ${label}
    </button>
  `).join("");
}

function renderThemeFilterButtons(sections: TimelineSection[]): string {
  if (sections.length === 0) return `<button type="button" disabled>暂无领域</button>`;
  return sections.map((section) => `
    <button type="button" data-personal-timeline-theme="${escapeHtml(section.filter)}">
      ${escapeHtml(section.title)}
    </button>
  `).join("");
}

function renderSourceFilterButtons(): string {
  return SOURCE_FILTERS.map((source) => `
    <button type="button" data-personal-timeline-source="${escapeHtml(source.label)}">
      ${escapeHtml(source.label)}
    </button>
  `).join("");
}

function renderTimelineView(sections: TimelineSection[]): string {
  return `
    <div class="personal-timeline__view is-active">
      <div class="personal-timeline__facts">
        <h2>时间线事实</h2>
        ${sections.map(renderFactSection).join("")}
      </div>
      <aside class="personal-timeline__rail" aria-label="个人时间线">
        <h2>时间线</h2>
        <div class="personal-timeline__rail-list">
          ${renderTimelineRailItems(sections)}
        </div>
      </aside>
    </div>
  `;
}

function renderFactSection(section: TimelineSection): string {
  const attribute = section.kind === "date" ? "data-personal-timeline-fact-grain" : "data-personal-timeline-fact-theme";
  return `<section class="personal-timeline__fact-section" ${attribute}="${escapeHtml(section.filter)}">${section.html}</section>`;
}

function renderTimelineRailItems(sections: TimelineSection[]): string {
  const items = sections.flatMap((section) => section.rows.map((row) => ({ section: section.title, row })));
  if (items.length === 0) return `<p class="personal-timeline__empty">待填写</p>`;
  return items.map(({ section, row }) => `
    <article
      class="personal-timeline__rail-item"
      data-personal-timeline-rail-${sectionKindForTitle(section)}="${escapeHtml(sectionFilterForTitle(section))}"
    >
      <span>${escapeHtml(row[0] || section)}</span>
      <strong>${escapeHtml(row[1] || "待填写")}</strong>
      <em>${escapeHtml(row[2] || section)}</em>
    </article>
  `).join("");
}

function bindTimelineControls(article: HTMLElement): void {
  article.querySelectorAll<HTMLButtonElement>("[data-personal-timeline-grain]").forEach((button) => {
    button.addEventListener("click", () => toggleTimelineFilter(article, button, "grain"));
  });
  article.querySelectorAll<HTMLButtonElement>("[data-personal-timeline-theme]").forEach((button) => {
    button.addEventListener("click", () => toggleTimelineFilter(article, button, "theme"));
  });
  article.querySelectorAll<HTMLButtonElement>("[data-personal-timeline-source]").forEach((button) => {
    button.addEventListener("click", () => toggleTimelineFilter(article, button, "source"));
    button.addEventListener("dblclick", () => {
      if (button.dataset.personalTimelineSource === HISTORY_SOURCE_LABEL) {
        openManualSupplementDialog(article, HISTORY_SOURCE_PATH);
        return;
      }
      openSourceEntryEditor(article, button);
    });
  });
  refreshSourceEntryButtons(article);
  article.querySelector<HTMLButtonElement>("[data-personal-timeline-source-refresh]")?.addEventListener("click", () => {
    void refreshSelectedSource(article);
  });
  article.querySelector<HTMLInputElement>("[data-personal-timeline-search]")?.addEventListener("input", () => {
    applyTimelineFilters(article);
  });
}

function toggleTimelineFilter(article: HTMLElement, button: HTMLButtonElement, group: "grain" | "theme" | "source"): void {
  const selector = filterSelectorForGroup(group);
  const wasActive = button.classList.contains("is-active");
  article.querySelectorAll<HTMLButtonElement>(selector).forEach((item) => {
    item.classList.remove("is-active");
  });
  button.classList.toggle("is-active", !wasActive);
  if (group === "source") clearSourceRefreshStatus(article);
  applyTimelineFilters(article);
}

function filterSelectorForGroup(group: "grain" | "theme" | "source"): string {
  if (group === "grain") return "[data-personal-timeline-grain]";
  if (group === "theme") return "[data-personal-timeline-theme]";
  return "[data-personal-timeline-source]";
}

function applyTimelineFilters(article: HTMLElement): void {
  const grain = article.querySelector<HTMLButtonElement>("[data-personal-timeline-grain].is-active")
    ?.dataset.personalTimelineGrain;
  const theme = article.querySelector<HTMLButtonElement>("[data-personal-timeline-theme].is-active")
    ?.dataset.personalTimelineTheme;
  const source = article.querySelector<HTMLButtonElement>("[data-personal-timeline-source].is-active")
    ?.dataset.personalTimelineSource;
  const query = article.querySelector<HTMLInputElement>("[data-personal-timeline-search]")?.value.trim() ?? "";
  article.querySelectorAll<HTMLElement>(".personal-timeline__fact-section, .personal-timeline__rail-item")
    .forEach((item) => {
      item.hidden = !matchesTimelineFilters(item, grain, theme, source, query);
    });
}

function matchesTimelineFilters(
  item: HTMLElement,
  grain: string | undefined,
  theme: string | undefined,
  source: string | undefined,
  query: string,
): boolean {
  const text = item.textContent ?? "";
  return matchesSelectedTimelineGroup(item, grain, theme)
    && matchesSelectedSource(text, source)
    && matchesTimelineQuery(text, query);
}

function matchesSelectedTimelineGroup(item: HTMLElement, grain: string | undefined, theme: string | undefined): boolean {
  if (!grain && !theme) return true;
  return matchesTimelineGrain(item, grain) || matchesTimelineTheme(item, theme);
}

function matchesTimelineGrain(item: HTMLElement, grain: string | undefined): boolean {
  if (!grain) return false;
  return item.dataset.personalTimelineFactGrain === grain || item.dataset.personalTimelineRailGrain === grain;
}

function matchesTimelineTheme(item: HTMLElement, theme: string | undefined): boolean {
  if (!theme) return false;
  return item.dataset.personalTimelineFactTheme === theme || item.dataset.personalTimelineRailTheme === theme;
}

function matchesSelectedSource(text: string, source: string | undefined): boolean {
  return !source || sourceMatchesText(source, text);
}

function matchesTimelineQuery(text: string, query: string): boolean {
  return !query || text.includes(query);
}

function refreshSourceEntryButtons(article: HTMLElement): void {
  article.querySelectorAll<HTMLButtonElement>("[data-personal-timeline-source]").forEach((button) => {
    const label = button.dataset.personalTimelineSource ?? "";
    const entries = readSourceEntries(label);
    button.classList.toggle("has-entry", entries.length > 0);
    button.classList.toggle("has-no-entry", entries.length === 0);
    button.title = entries.length > 0 ? entries.join("\n") : "没有";
  });
}

async function refreshSelectedSource(article: HTMLElement): Promise<void> {
  const source = selectedSourceForRefresh(article);
  if (!source) {
    showSourceRefreshStatus(article, "先选择输入来源", "idle");
    return;
  }
  const label = source.dataset.personalTimelineSource ?? "";
  const entries = readSourceEntries(label);
  showSourceRefreshStatus(article, "正在写入", "running");
  try {
    const payload = await requestSourceRefresh(label, entries);
    showSourceRefreshStatus(article, payload.message, payload.status === "written" ? "done" : "idle");
  } catch {
    showSourceRefreshStatus(article, "故障，已写入审查页", "failed");
  }
}

function selectedSourceForRefresh(article: HTMLElement): HTMLButtonElement | null {
  const selected = article.querySelector<HTMLButtonElement>("[data-personal-timeline-source].is-active");
  if (selected) return selected;
  const diary = article.querySelector<HTMLButtonElement>("[data-personal-timeline-source='日记']");
  if (!diary) return null;
  diary.classList.add("is-active");
  applyTimelineFilters(article);
  return diary;
}

async function requestSourceRefresh(label: string, entries: string[]): Promise<SourceRefreshPayload> {
  const response = await fetch("/api/wiki/personal-timeline/source-refresh", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ label, entries }),
  });
  const payload = await response.json() as { success?: boolean; data?: SourceRefreshPayload; error?: string };
  if (!response.ok || payload.success === false || !payload.data) {
    throw new Error(payload.error ?? "source refresh failed");
  }
  return payload.data;
}

function showSourceRefreshStatus(article: HTMLElement, message: string, state: SourceRefreshState): void {
  const status = article.querySelector<HTMLElement>("[data-personal-timeline-source-status]");
  if (!status) return;
  status.hidden = false;
  status.className = `personal-timeline__source-status is-${state}`;
  status.innerHTML = `<span>${escapeHtml(message)}</span>${sourceRefreshProgressHtml(state)}`;
}

function sourceRefreshProgressHtml(state: SourceRefreshState): string {
  if (state !== "running" && state !== "done") return "";
  const value = state === "done" ? "100" : "50";
  const label = state === "done" ? "刷新完成" : "刷新中";
  return `<div data-personal-timeline-source-progress role="progressbar" aria-label="${label}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${value}"><i></i></div>`;
}

function clearSourceRefreshStatus(article: HTMLElement): void {
  const status = article.querySelector<HTMLElement>("[data-personal-timeline-source-status]");
  if (!status) return;
  status.hidden = true;
  status.className = "personal-timeline__source-status";
  status.textContent = "";
}

function openSourceEntryEditor(article: HTMLElement, button: HTMLButtonElement): void {
  const label = button.dataset.personalTimelineSource ?? "";
  const editor = article.querySelector<HTMLElement>("[data-personal-timeline-source-editor]");
  if (!editor) return;
  editor.hidden = false;
  editor.innerHTML = renderSourceEntryEditor(label, readSourceEntries(label));
  bindSourceEntryEditor(article, editor, label);
}

function renderSourceEntryEditor(label: string, entries: string[]): string {
  const list = entries.length > 0 ? entries.map((entry, index) => `
    <li>
      <code>${escapeHtml(entry)}</code>
      <button type="button" data-personal-timeline-source-remove="${index}">删除</button>
    </li>
  `).join("") : `<li class="personal-timeline__source-empty">没有</li>`;
  return `
    <section class="personal-timeline__source-dialog" role="dialog" aria-modal="true" aria-label="${escapeHtml(label)}入口">
      <header>
        <strong>${escapeHtml(label)}入口</strong>
        <button type="button" data-personal-timeline-source-close>关闭</button>
      </header>
      <ul>${list}</ul>
      <div>
        <input type="text" placeholder="输入相对路径或桌面绝对路径" data-personal-timeline-source-input />
        <button type="button" data-personal-timeline-source-pick>选择路径</button>
        <button type="button" data-personal-timeline-source-add>新增</button>
      </div>
      <p class="personal-timeline__source-editor-status" data-personal-timeline-source-editor-status></p>
    </section>
  `;
}

function bindSourceEntryEditor(article: HTMLElement, editor: HTMLElement, label: string): void {
  editor.onclick = (event) => {
    if (event.target === editor) editor.hidden = true;
  };
  editor.querySelector<HTMLElement>(".personal-timeline__source-dialog")?.addEventListener("click", (event) => {
    event.stopPropagation();
  });
  editor.querySelector<HTMLButtonElement>("[data-personal-timeline-source-add]")?.addEventListener("click", () => {
    const input = editor.querySelector<HTMLInputElement>("[data-personal-timeline-source-input]");
    const entry = input?.value.trim() ?? "";
    if (!entry) {
      showSourceEditorStatus(editor, "先输入或选择一个路径。");
      return;
    }
    updateSourceEntries(article, label, [...readSourceEntries(label), entry]);
  });
  editor.querySelector<HTMLButtonElement>("[data-personal-timeline-source-pick]")?.addEventListener("click", () => {
    void chooseSourceEntryPath(editor);
  });
  editor.querySelectorAll<HTMLButtonElement>("[data-personal-timeline-source-remove]").forEach((button) => {
    button.addEventListener("click", () => removeSourceEntry(article, label, Number(button.dataset.personalTimelineSourceRemove)));
  });
  editor.querySelector<HTMLButtonElement>("[data-personal-timeline-source-close]")?.addEventListener("click", () => {
    editor.hidden = true;
  });
}

async function chooseSourceEntryPath(editor: HTMLElement): Promise<void> {
  const input = editor.querySelector<HTMLInputElement>("[data-personal-timeline-source-input]");
  if (!window.llmWikiDesktop?.choosePersonalTimelineSourceEntry) {
    showSourceEditorStatus(editor, "当前窗口没有桌面路径选择能力，请手动输入相对路径或绝对路径。");
    return;
  }
  const selected = await window.llmWikiDesktop.choosePersonalTimelineSourceEntry();
  if (input && selected) {
    input.value = selected;
    showSourceEditorStatus(editor, "已选择路径。");
  }
}

function showSourceEditorStatus(editor: HTMLElement, message: string): void {
  const status = editor.querySelector<HTMLElement>("[data-personal-timeline-source-editor-status]");
  if (status) status.textContent = message;
}

function removeSourceEntry(article: HTMLElement, label: string, index: number): void {
  updateSourceEntries(article, label, readSourceEntries(label).filter((_, itemIndex) => itemIndex !== index));
}

function updateSourceEntries(article: HTMLElement, label: string, entries: string[]): void {
  writeSourceEntries(label, entries.map((entry) => entry.trim()).filter(Boolean));
  refreshSourceEntryButtons(article);
  const button = article.querySelector<HTMLButtonElement>(`[data-personal-timeline-source="${cssEscape(label)}"]`);
  if (button) openSourceEntryEditor(article, button);
}

function readSourceEntries(label: string): string[] {
  const saved = readSavedSourceEntries()[label];
  if (label === HISTORY_SOURCE_LABEL && (!saved || saved.length === 0)) {
    return [HISTORY_SOURCE_PATH];
  }
  return saved ?? SOURCE_FILTERS.find((source) => source.label === label)?.entries ?? [];
}

function writeSourceEntries(label: string, entries: string[]): void {
  const saved = readSavedSourceEntries();
  saved[label] = entries;
  localStorage.setItem(SOURCE_ENTRY_STORAGE_KEY, JSON.stringify(saved));
}

function readSavedSourceEntries(): Record<string, string[]> {
  const parsed = parseJsonObject(localStorage.getItem(SOURCE_ENTRY_STORAGE_KEY));
  return Object.fromEntries(Object.entries(parsed).filter(isStringListEntry));
}

function parseJsonObject(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function isStringListEntry(entry: [string, unknown]): entry is [string, string[]] {
  return Array.isArray(entry[1]) && entry[1].every((item) => typeof item === "string");
}

function cssEscape(value: string): string {
  return typeof CSS !== "undefined" && CSS.escape ? CSS.escape(value) : value.replace(/"/g, '\\"');
}

function sourceMatchesText(label: string, text: string): boolean {
  const source = SOURCE_FILTERS.find((item) => item.label === label);
  return source?.aliases.some((alias) => text.includes(alias)) ?? false;
}

function dateGranularityForTitle(title: string): DateGranularity {
  if (title === "按月") return "month";
  if (title === "按年") return "year";
  if (title === "按十年") return "decade";
  return "day";
}

function sectionKindForTitle(title: string): "grain" | "theme" {
  return DATE_SECTION_TITLES.includes(title) ? "grain" : "theme";
}

function sectionFilterForTitle(title: string): string {
  return DATE_SECTION_TITLES.includes(title) ? dateGranularityForTitle(title) : title;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (character) => {
    switch (character) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      default: return character;
    }
  });
}
