/**
 * View rendering helpers for the dedicated about-me profile page.
 *
 * This file keeps the dashboard markup separate from the page controller so
 * the interactive editing flow can stay small and readable.
 */

import type {
  AboutMeEntry,
  AboutMeProfileDocument,
  AboutMeSection,
  AboutMeSubsection,
  AboutMeTimelineEntry,
} from "./about-me-profile-markdown.js";
import {
  escapeHtml,
  formatDateTime,
  renderFieldRow,
  renderPlainRow,
  renderStatCard,
  renderTag,
  wikiHref,
} from "./about-me-profile-helpers.js";

export type AboutMeTab = "首页" | "时间线" | "成果库" | "能力" | "简历";
export type AboutMeHomeSideCardTab = "时间线" | "简历";

export interface AboutMeProfileViewModel {
  readonly path: string;
  readonly modifiedAt: string;
  readonly raw: string;
  readonly sourceEditable: boolean;
  readonly activeTab: AboutMeTab;
  readonly editing: boolean;
  readonly saving: boolean;
  readonly statusMessage: string;
  readonly activeHomeSideCard: AboutMeHomeSideCardTab;
  readonly document: AboutMeProfileDocument | null;
}

const ABOUT_ME_TABS: readonly AboutMeTab[] = ["首页", "时间线", "成果库", "能力", "简历"];

export function renderProfileShell(path: string): string {
  return `
    <div data-about-me-profile>
      ${renderTopBar("About Me", false, false, false, "")}
      <section class="about-me-profile__empty-state">
        <div class="about-me-profile__empty-card">
          <h1>About Me</h1>
          <p>正在加载 <code>${escapeHtml(path)}</code>...</p>
        </div>
      </section>
    </div>
  `;
}

export function renderMissingProfile(path: string): string {
  return `
    <div data-about-me-profile>
      ${renderTopBar("About Me", false, false, false, "")}
      <section class="about-me-profile__empty-state">
        <div class="about-me-profile__empty-card">
          <h1>About Me</h1>
          <p>尚未找到 <code>${escapeHtml(path)}</code>。</p>
          <p>创建这份 Markdown 后，个人展示页会按固定模块自动渲染。</p>
        </div>
      </section>
    </div>
  `;
}

export function renderLoadedProfile(view: AboutMeProfileViewModel): string {
  if (!view.document) {
    return renderMissingProfile(view.path);
  }
  return `
    <div data-about-me-profile>
      ${renderTopBar(
        view.document.title,
        view.sourceEditable,
        view.editing,
        view.saving,
        view.statusMessage,
      )}
      ${renderEditorShell(view)}
      <div class="about-me-profile__panel-wrap"${view.editing ? " hidden" : ""}>
        ${renderHomePanel(view.document, view.modifiedAt, view.activeHomeSideCard)}
        ${renderTimelinePanel(view.document.timeline)}
        ${renderAchievementsPanel(view.document.achievements)}
        ${renderAbilityPanel(view.document)}
        ${renderResumePanel(view.document.resume)}
      </div>
    </div>
  `;
}

function renderTopBar(
  title: string,
  sourceEditable: boolean,
  editing: boolean,
  saving: boolean,
  statusMessage: string,
): string {
  return `
    <header class="about-me-profile__topbar">
      <a class="about-me-profile__brand" href="${wikiHref("wiki/个人信息档案/about-me.md")}">
        <span class="about-me-profile__brand-mark">S</span>
        <span class="about-me-profile__brand-copy">
          <strong>${escapeHtml(title)}</strong>
          <span>记录成长 · 沉淀价值 · 连接未来</span>
        </span>
      </a>
      <div class="about-me-profile__topbar-tools">
        ${renderEditorActions(sourceEditable, editing, saving, statusMessage)}
        <nav class="about-me-profile__tabs" aria-label="About Me Tabs">
          ${ABOUT_ME_TABS.map((tab) => renderTabButton(tab, !editing && tab === "首页")).join("")}
          <button type="button" class="about-me-profile__theme">◐</button>
        </nav>
      </div>
    </header>
  `;
}

function renderEditorActions(
  sourceEditable: boolean,
  editing: boolean,
  saving: boolean,
  statusMessage: string,
): string {
  if (!sourceEditable) {
    return "";
  }
  return `
    <div class="about-me-profile__editor-actions">
      <button
        type="button"
        class="about-me-profile__toolbar-btn"
        data-about-me-edit
        ${editing ? "hidden" : ""}
      >编辑 Markdown</button>
      <button
        type="button"
        class="about-me-profile__toolbar-btn about-me-profile__toolbar-btn--primary"
        data-about-me-save
        ${editing ? "" : "hidden"}
        ${saving ? "disabled" : ""}
      >${saving ? "保存中..." : "保存"}</button>
      <button
        type="button"
        class="about-me-profile__toolbar-btn"
        data-about-me-cancel
        ${editing ? "" : "hidden"}
        ${saving ? "disabled" : ""}
      >取消</button>
      <span class="about-me-profile__editor-status" data-about-me-status>${escapeHtml(statusMessage)}</span>
    </div>
  `;
}

function renderTabButton(tab: AboutMeTab, active: boolean): string {
  return `
    <button
      type="button"
      class="about-me-profile__tab${active ? " is-active" : ""}"
      data-about-me-tab="${tab}"
      aria-selected="${active ? "true" : "false"}"
    >${tab}</button>
  `;
}

function renderEditorShell(view: AboutMeProfileViewModel): string {
  if (!view.editing) {
    return "";
  }
  return `
    <section class="about-me-profile__editor-shell" data-about-me-editor-shell>
      <p class="about-me-profile__editor-hint">
        这里直接编辑 <code>${escapeHtml(view.path)}</code> 的原始 Markdown。头像也通过 Markdown 图片链接修改。
      </p>
      <textarea
        class="about-me-profile__editor"
        data-about-me-editor
        spellcheck="false"
      >${escapeHtml(view.raw)}</textarea>
    </section>
  `;
}

function renderHomePanel(
  document: AboutMeProfileDocument,
  modifiedAt: string,
  activeHomeSideCard: AboutMeHomeSideCardTab,
): string {
  return `
    <section class="about-me-profile__panel about-me-profile__panel--home" data-about-me-panel="首页">
      ${renderHero(document, modifiedAt)}
      ${renderHomeIntro(document.home)}
      <div class="about-me-profile__content">
        ${renderAchievementBoard(document.achievements)}
        <div class="about-me-profile__side-column">
          ${renderHomeSideCard(document.timeline, document.resume, activeHomeSideCard)}
        </div>
      </div>
      ${renderStrengthRow(document.strengths)}
    </section>
  `;
}

function renderHomeIntro(section: AboutMeSection): string {
  const lines = [
    ...section.paragraphs,
    ...section.subsections
      .filter((subsection) => !["标签", "统计卡片", "代表能力", "首页说明"].includes(subsection.title))
      .flatMap((subsection) => subsection.paragraphs),
  ];
  if (lines.length === 0) {
    return "";
  }
  return `
    <div class="about-me-profile__home-intro">
      ${lines.map((line) => `<p>${escapeHtml(line)}</p>`).join("")}
    </div>
  `;
}

function renderHero(document: AboutMeProfileDocument, modifiedAt: string): string {
  return `
    <section class="about-me-profile__hero" data-about-me-hero>
      <div class="about-me-profile__avatar">
        ${renderAvatar(document)}
      </div>
      <div class="about-me-profile__hero-copy">
        <p class="about-me-profile__hero-updated">更新于 ${escapeHtml(formatDateTime(modifiedAt))}</p>
        <h1>${escapeHtml(document.title)}</h1>
        <p class="about-me-profile__hero-subtitle">${escapeHtml(document.subtitle)}</p>
        <p class="about-me-profile__hero-quote">${escapeHtml(document.quote)}</p>
        <div class="about-me-profile__hero-tags">${document.heroTags.map(renderTag).join("")}</div>
      </div>
      <section class="about-me-profile__stats-card" data-about-me-stats-card>
        ${document.heroStats.map(renderStatCard).join("")}
      </section>
    </section>
  `;
}

function renderAvatar(document: AboutMeProfileDocument): string {
  if (document.avatarImage) {
    return `<img src="${escapeHtml(document.avatarImage)}" alt="${escapeHtml(document.title)}" />`;
  }
  return `<div class="about-me-profile__avatar-fallback">${escapeHtml(document.title.slice(0, 1) || "A")}</div>`;
}

function renderAchievementBoard(section: AboutMeSection): string {
  return `
    <section class="about-me-profile__board" data-about-me-achievement-board>
      <div class="about-me-profile__section-title">成果库</div>
      <div class="about-me-profile__achievement-grid">
        ${section.subsections.map(renderAchievementGroup).join("")}
      </div>
    </section>
  `;
}

function renderAchievementGroup(subsection: AboutMeSubsection): string {
  return `
    <article class="about-me-profile__achievement-card">
      <header>
        <h2>${escapeHtml(subsection.title)}</h2>
        <span>查看全部</span>
      </header>
      <div class="about-me-profile__achievement-items">
        ${subsection.entries.map(renderAchievementEntry).join("") || renderBulletRows(subsection.bullets)}
      </div>
      <div class="about-me-profile__chip-row">${subsection.bullets.slice(0, 3).map(renderTag).join("")}</div>
    </article>
  `;
}

function renderAchievementEntry(entry: AboutMeEntry): string {
  const summary = entry.paragraphs[0] ?? "";
  const badge = entry.fields[0]?.value ?? "";
  return `
    <article class="about-me-profile__achievement-item">
      <div class="about-me-profile__achievement-thumb"></div>
      <div class="about-me-profile__achievement-copy">
        <strong>${escapeHtml(entry.title)}</strong>
        <p>${escapeHtml(summary)}</p>
      </div>
      ${badge ? `<span class="about-me-profile__badge">${escapeHtml(badge)}</span>` : ""}
    </article>
  `;
}

function renderBulletRows(items: string[]): string {
  return items.map((item) => `
    <article class="about-me-profile__achievement-item about-me-profile__achievement-item--text">
      <div class="about-me-profile__achievement-copy">
        <strong>${escapeHtml(item)}</strong>
      </div>
    </article>
  `).join("");
}

function renderTimelineEntry(entry: AboutMeTimelineEntry): string {
  return `
    <article class="about-me-profile__timeline-entry">
      <div class="about-me-profile__timeline-year">${escapeHtml(entry.year)}</div>
      <div class="about-me-profile__timeline-copy">
        <strong>${escapeHtml(entry.title)}</strong>
        <p>${escapeHtml(entry.description)}</p>
      </div>
    </article>
  `;
}

function renderHomeSideCard(
  entries: AboutMeTimelineEntry[],
  section: AboutMeSection,
  activeTab: AboutMeHomeSideCardTab,
): string {
  const timelineActive = activeTab === "时间线";
  return `
    <section
      class="about-me-profile__side-card ${timelineActive ? "about-me-profile__timeline-card" : "about-me-profile__resume-card"}"
      data-about-me-home-side-card="${activeTab}"
    >
      <header class="about-me-profile__side-card-header">
        <h2>${timelineActive ? "人生时间线" : "简历"}</h2>
        <div class="about-me-profile__side-card-switches">
          ${renderHomeSideCardButton("时间线", timelineActive)}
          ${renderHomeSideCardButton("简历", !timelineActive)}
        </div>
      </header>
      <div class="about-me-profile__side-card-body">
        ${timelineActive ? renderHomeTimeline(entries) : renderHomeResume(section)}
      </div>
    </section>
  `;
}

function renderHomeSideCardButton(tab: AboutMeHomeSideCardTab, active: boolean): string {
  return `
    <button
      type="button"
      class="about-me-profile__side-card-switch${active ? " is-active" : ""}"
      data-about-me-home-panel-switch="${tab}"
      aria-pressed="${active ? "true" : "false"}"
    >${tab}</button>
  `;
}

function renderHomeTimeline(entries: AboutMeTimelineEntry[]): string {
  return `<div class="about-me-profile__timeline-list" data-about-me-home-timeline data-about-me-timeline>${entries.map(renderTimelineEntry).join("")}</div>`;
}

function renderHomeResume(section: AboutMeSection): string {
  return `<div class="about-me-profile__resume-card-body" data-about-me-home-resume data-about-me-resume-card>${section.subsections.map((subsection) => renderResumeSubsection(subsection, false)).join("")}</div>`;
}

function renderResumePanel(section: AboutMeSection): string {
  return `
    <section class="about-me-profile__panel" data-about-me-panel="简历" hidden>
      <section class="about-me-profile__resume-page">
        <h2>简历</h2>
        ${section.subsections.map((subsection) => renderResumeSubsection(subsection, true)).join("")}
      </section>
    </section>
  `;
}

function renderResumeSubsection(subsection: AboutMeSubsection, expanded: boolean): string {
  const contactAttr = subsection.title === "联系方式" ? ` data-about-me-resume-contact` : "";
  const items = subsection.fields.length > 0
    ? subsection.fields.map((field) => renderFieldRow(field)).join("")
    : subsection.bullets.map((value) => renderPlainRow(value)).join("");
  const description = subsection.paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("");
  return `
    <section class="about-me-profile__resume-section${expanded ? " about-me-profile__resume-section--expanded" : ""}"${contactAttr}>
      <h3>${escapeHtml(subsection.title)}</h3>
      ${description}
      <div class="about-me-profile__resume-items">${items}</div>
    </section>
  `;
}

function renderStrengthRow(items: string[]): string {
  return `
    <section class="about-me-profile__strengths">
      <div class="about-me-profile__section-title">代表能力</div>
      <div class="about-me-profile__strength-grid" data-about-me-strength-grid>
        ${items.map(renderStrengthCard).join("")}
      </div>
    </section>
  `;
}

function renderStrengthCard(value: string): string {
  return `
    <article class="about-me-profile__strength-card">
      <strong>${escapeHtml(value)}</strong>
      <p>持续沉淀中的核心能力</p>
      <div class="about-me-profile__strength-dots"><span></span><span></span><span></span><span></span><span></span></div>
    </article>
  `;
}

function renderTimelinePanel(entries: AboutMeTimelineEntry[]): string {
  return `
    <section class="about-me-profile__panel" data-about-me-panel="时间线" hidden>
      <section class="about-me-profile__timeline-page">
        <h2>时间线</h2>
        <div class="about-me-profile__timeline-page-list">${entries.map(renderTimelineEntry).join("")}</div>
      </section>
    </section>
  `;
}

function renderAchievementsPanel(section: AboutMeSection): string {
  return `
    <section class="about-me-profile__panel" data-about-me-panel="成果库" hidden>
      ${renderAchievementBoard(section)}
    </section>
  `;
}

function renderAbilityPanel(document: AboutMeProfileDocument): string {
  return `
    <section class="about-me-profile__panel" data-about-me-panel="能力" hidden>
      ${renderStrengthRow(document.strengths)}
      <section class="about-me-profile__ability-page">
        ${document.ability.subsections.map(renderAbilitySection).join("")}
      </section>
    </section>
  `;
}

function renderAbilitySection(subsection: AboutMeSubsection): string {
  return `
    <article class="about-me-profile__ability-card">
      <h3>${escapeHtml(subsection.title)}</h3>
      ${subsection.paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("")}
      <div class="about-me-profile__chip-row">${subsection.bullets.map(renderTag).join("")}</div>
    </article>
  `;
}
