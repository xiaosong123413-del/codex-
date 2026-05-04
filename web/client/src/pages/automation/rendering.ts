/**
 * Markup helpers for the automation workspace pages.
 *
 * The page module owns state and event wiring. This file only builds compact
 * HTML fragments for the automation list cards and source labels.
 */

import { renderIcon } from "../../components/icon.js";
import type { AutomationListItem } from "./api.js";

const AUTOMATION_ICON_MAP: Record<string, string> = {
  bot: "message-square",
  "book-open": "book-open-text",
  calendar: "clipboard-list",
  "git-branch": "list-checks",
  "message-circle": "message-square",
  rocket: "hammer",
  sparkles: "copy",
};

interface AutomationListSection {
  title: string;
  description: string;
  items: AutomationListItem[];
}

export function createAutomationListSectionHtml(section: AutomationListSection): string {
  return `
    <section class="automation-page__section">
      <div class="automation-page__section-header">
        <div>
          <h2>${escapeHtml(section.title)}</h2>
          <p>${escapeHtml(section.description)}</p>
        </div>
      </div>
      <div class="automation-page__section-list">
        ${section.items.map((item) => createAutomationListCardHtml(item)).join("")}
      </div>
    </section>
  `;
}

export function getSourceLabel(sourceKind: AutomationListItem["sourceKind"]): string {
  switch (sourceKind) {
    case "automation":
      return "显式 Workflow";
    case "app":
      return "应用流程";
    case "information":
      return "信息流转流程";
    case "code":
      return "源码真实流程";
    default:
      return "源码真实流程";
  }
}

export function isCodeItem(item: Pick<AutomationListItem, "sourceKind">): boolean {
  return item.sourceKind === "code";
}

export function isExecutableItem(item: Pick<AutomationListItem, "sourceKind">): boolean {
  return item.sourceKind === "automation" || item.sourceKind === "app";
}

export function isInformationItem(item: Pick<AutomationListItem, "sourceKind">): boolean {
  return item.sourceKind === "information";
}

function createAutomationListCardHtml(item: AutomationListItem): string {
  const meta = isExecutableItem(item)
    ? `
      <span class="automation-list-card__source" data-source-kind="${item.sourceKind}">${escapeHtml(getSourceLabel(item.sourceKind))}</span>
      <span class="automation-list-card__status" data-enabled="${item.enabled ? "true" : "false"}">${item.enabled ? "运行中" : "未启动"}</span>
      <button type="button" class="btn btn-secondary" data-automation-log="${escapeAttr(item.id)}">运行日志</button>
    `
    : `<span class="automation-list-card__source" data-source-kind="${item.sourceKind}">${escapeHtml(getSourceLabel(item.sourceKind))}</span>`;
  return `
    <article class="automation-list-card" data-automation-item="${escapeAttr(item.id)}">
      <button type="button" class="automation-list-card__open" data-automation-open="${escapeAttr(item.id)}">
        <div class="automation-list-card__icon">${renderAutomationIcon(item.icon)}</div>
        <div class="automation-list-card__content">
          <h2>${escapeHtml(item.name)}</h2>
          <p>${escapeHtml(item.summary)}</p>
        </div>
      </button>
      <div class="automation-list-card__meta">
        ${meta}
      </div>
    </article>
  `;
}


function renderAutomationIcon(icon: string): string {
  const normalized = AUTOMATION_ICON_MAP[icon] ?? AUTOMATION_ICON_MAP[icon.toLowerCase()];
  if (normalized) {
    return renderIcon(normalized, { size: 18 });
  }
  const fallback = icon.trim().slice(0, 2).toUpperCase() || "AU";
  return `<span class="automation-list-card__icon-fallback">${escapeHtml(fallback)}</span>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[character] ?? character));
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/'/g, "&#39;");
}
