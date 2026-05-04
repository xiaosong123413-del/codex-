/**
 * Rendering helpers for the editable identity dashboard widgets.
 */
import type { IdentityDashboardConfig, IdentityDashboardWidget } from "./identity-dashboard-types.js";

const RELATION_TARGET = "wiki/crm/人际关系总览.md";
const HEALTH_DOMAIN_TARGET = "#/workspace/task-pool/domain/health";

export function renderIdentityDashboard(config: IdentityDashboardConfig, editing: boolean, selectedId = ""): string {
  return `
    <main class="identity-info-page__canvas" data-identity-dashboard-canvas>
      ${config.widgets.filter((widget) => widget.enabled).map((widget) => renderWidget(widget, editing, selectedId)).join("")}
    </main>
  `;
}

function renderWidget(widget: IdentityDashboardWidget, editing: boolean, selectedId: string): string {
  const selectedClass = widget.id === selectedId ? " is-selected" : "";
  const editable = editing ? "true" : "false";
  return `
    <section
      class="identity-info-page__widget identity-info-page__widget--${escapeHtml(widget.type)} ${legacyWidgetClass(widget.type)}${selectedClass}"
      style="${layoutStyle(widget)}"
      data-identity-widget="${escapeHtml(widget.id)}"
      data-identity-widget-type="${escapeHtml(widget.type)}"
      draggable="${editable}"
    >
      ${renderWidgetBody(widget, editing)}
      ${editing ? `<button type="button" class="identity-info-page__resize" data-identity-widget-resize aria-label="调整大小"></button>` : ""}
    </section>
  `;
}

// fallow-ignore-next-line complexity
function renderWidgetBody(widget: IdentityDashboardWidget, editing: boolean): string {
  if (widget.type === "hero") return renderHero(widget, editing);
  if (widget.type === "stage") return renderStage(widget, editing);
  if (widget.type === "timeline") return renderTimeline(widget, editing);
  if (widget.type === "nav") return renderNav(widget, editing);
  if (widget.type === "relations") return renderRelations(widget, editing);
  if (widget.type === "dreams") return renderDreams(widget, editing);
  if (widget.type === "health") return renderHealth(widget, editing);
  if (widget.type === "mood" || widget.type === "goals") return renderKeyValueList(widget, editing);
  if (widget.type === "metaphysics") return renderMetaphysics(widget, editing);
  if (widget.type === "table") return renderTable(widget, editing);
  if (widget.type === "list") return renderList(widget, editing);
  return renderText(widget, editing);
}

function renderHero(widget: IdentityDashboardWidget, editing: boolean): string {
  const name = stringData(widget, "name", "我");
  const avatarImage = stringData(widget, "avatarImage", "");
  const rows = arrayData(widget, "rows");
  const tags = arrayData(widget, "tags");
  const avatar = avatarImage
    ? `<img src="/api/page-side-image?path=${encodeURIComponent(avatarImage)}" alt="${escapeHtml(name)}" />`
    : escapeHtml(name.charAt(0) || "我");
  return `
    <button type="button" class="identity-info-page__avatar" data-identity-avatar-open>${avatar}</button>
    <div class="identity-info-page__hero-copy">
      ${rows.map((row, index) => `<p>${editableText(labelAt(row, 0), editing, `rows.${index}.0`)}：${editableText(labelAt(row, 1), editing, `rows.${index}.1`)}</p>`).join("")}
      <div class="identity-info-page__chips">${tags.map((tag, index) => `<span>${editableText(String(tag), editing, `tags.${index}`)}</span>`).join("")}</div>
    </div>
  `;
}

function renderStage(widget: IdentityDashboardWidget, editing: boolean): string {
  return renderPanel(widget, arrayData(widget, "rows").map((row, index) => `
    <div class="identity-info-page__stage-row">
      <strong>${editableText(labelAt(row, 0), editing, `rows.${index}.0`)}</strong>
      <span>${editableText(labelAt(row, 1), editing, `rows.${index}.1`)}</span>
      <em>${editableText(labelAt(row, 2), editing, `rows.${index}.2`)}</em>
    </div>
  `).join(""));
}

function renderTimeline(widget: IdentityDashboardWidget, editing: boolean): string {
  return renderPanel(widget, `
    <div class="identity-info-page__timeline-list">
      ${arrayData(widget, "items").map((item, index) => `
        <article class="identity-info-page__timeline-item">
          <span>${editableText(labelAt(item, "date"), editing, `items.${index}.date`)}</span>
          <strong>${editableText(labelAt(item, "fact"), editing, `items.${index}.fact`)}</strong>
        </article>
      `).join("")}
    </div>
  `);
}

function renderNav(widget: IdentityDashboardWidget, editing: boolean): string {
  return `
    <nav class="identity-info-page__nav-widget">
      ${arrayData(widget, "items").map((item, index) => `
        ${editing ? `<span class="identity-info-page__nav-edit-item">` : `<a href="#/wiki/${encodeURIComponent("wiki/个人信息档案/个人身份信息档案.md")}">`}
          <span>${editableText(labelAt(item, 1), editing, `items.${index}.1`)}</span>
          <strong>${editableText(labelAt(item, 0), editing, `items.${index}.0`)}</strong>
        ${editing ? "</span>" : "</a>"}
      `).join("")}
    </nav>
  `;
}

function renderRelations(widget: IdentityDashboardWidget, editing: boolean): string {
  return renderPanel(widget, `
    <div class="identity-info-page__relation-graph" data-identity-relation-graph>
      <span>正在同步人际关系图谱...</span>
    </div>
  `, !editing);
}

function renderDreams(widget: IdentityDashboardWidget, editing: boolean): string {
  return renderPanel(widget, `
    <ul class="identity-info-page__media-list">
      ${arrayData(widget, "items").map((item, index) => `
        <li><span></span><div><strong>${editableText(labelAt(item, 0), editing, `items.${index}.0`)}</strong><em>${editableText(labelAt(item, 1), editing, `items.${index}.1`)}</em></div></li>
      `).join("")}
    </ul>
    <p>${editableText(stringData(widget, "note", ""), editing, "note")}</p>
  `);
}

function renderHealth(widget: IdentityDashboardWidget, editing: boolean): string {
  const body = `
    <div class="identity-info-page__metric-grid">
      ${arrayData(widget, "metrics").map((item, index) => `<span><strong>${editableText(labelAt(item, 0), editing, `metrics.${index}.0`)}</strong>${editableText(labelAt(item, 1), editing, `metrics.${index}.1`)}</span>`).join("")}
    </div>
    <p>${editableText(stringData(widget, "note", ""), editing, "note")}</p>
  `;
  return editing ? renderPanel(widget, body) : renderLinkedPanel(widget, body, HEALTH_DOMAIN_TARGET);
}

function renderKeyValueList(widget: IdentityDashboardWidget, editing: boolean): string {
  return renderPanel(widget, `
    <ul class="identity-info-page__stack-list">
      ${arrayData(widget, "rows").map((row, index) => `<li><strong>${editableText(labelAt(row, 0), editing, `rows.${index}.0`)}</strong><span>${editableText(labelAt(row, 1), editing, `rows.${index}.1`)}</span></li>`).join("")}
    </ul>
  `);
}

function renderMetaphysics(widget: IdentityDashboardWidget, editing: boolean): string {
  return renderPanel(widget, `
    <div class="identity-info-page__symbol-grid">
      ${arrayData(widget, "items").map((item, index) => `<span>${editableText(String(item), editing, `items.${index}`)}<small>待补充</small></span>`).join("")}
    </div>
    <p>${editableText(stringData(widget, "note", ""), editing, "note")}</p>
  `);
}

function renderText(widget: IdentityDashboardWidget, editing: boolean): string {
  return renderPanel(widget, `<p>${editableText(stringData(widget, "text", "待填写"), editing, "text")}</p>`);
}

function renderTable(widget: IdentityDashboardWidget, editing: boolean): string {
  return renderPanel(widget, `<table>${arrayData(widget, "rows").map((row, rowIndex) => {
    const cells = Array.isArray(row) ? row : [];
    return `<tr>${cells.map((cell, cellIndex) => `<td>${editableText(String(cell), editing, `rows.${rowIndex}.${cellIndex}`)}</td>`).join("")}</tr>`;
  }).join("")}</table>`);
}

function renderList(widget: IdentityDashboardWidget, editing: boolean): string {
  return renderPanel(widget, `<ul>${arrayData(widget, "items").map((item, index) => `<li>${editableText(String(item), editing, `items.${index}`)}</li>`).join("")}</ul>`);
}

function renderPanel(widget: IdentityDashboardWidget, body: string, linkTitle = false): string {
  const title = linkTitle
    ? `<a href="#/wiki/${encodeURIComponent(RELATION_TARGET)}">${escapeHtml(widget.title)}</a>`
    : escapeHtml(widget.title);
  return `<div class="identity-info-page__panel"><h2>${title}</h2>${body}${renderSource(widget)}</div>`;
}

function renderLinkedPanel(widget: IdentityDashboardWidget, body: string, href: string): string {
  return `<a class="identity-info-page__panel identity-info-page__panel-link" href="${escapeHtml(href)}"><h2>${escapeHtml(widget.title)}</h2>${body}${renderSource(widget)}</a>`;
}

function renderSource(widget: IdentityDashboardWidget): string {
  const label = widget.source.kind === "ai" ? "AI" : widget.source.kind === "sync" ? "同步" : "手写";
  return `<small class="identity-info-page__source">${escapeHtml(label)}${widget.source.note ? ` · ${escapeHtml(widget.source.note)}` : ""}</small>`;
}

function editableText(value: string, editing: boolean, path: string): string {
  if (!editing) return escapeHtml(value);
  return `<span contenteditable="true" draggable="false" data-identity-field="${escapeHtml(path)}">${escapeHtml(value)}</span>`;
}

function layoutStyle(widget: IdentityDashboardWidget): string {
  const { x, y, w, h } = widget.layout;
  return `grid-column:${x + 1} / span ${w};grid-row:${y + 1} / span ${h};`;
}

function legacyWidgetClass(type: string): string {
  return `identity-info-page__${type}`;
}

function stringData(widget: IdentityDashboardWidget, key: string, fallback: string): string {
  const value = widget.data[key];
  return typeof value === "string" ? value : fallback;
}

function arrayData(widget: IdentityDashboardWidget, key: string): unknown[] {
  const value = widget.data[key];
  return Array.isArray(value) ? value : [];
}

function labelAt(value: unknown, key: string | number): string {
  if (Array.isArray(value) && typeof key === "number") return String(value[key] ?? "");
  if (value && typeof value === "object" && typeof key === "string") {
    return String((value as Record<string, unknown>)[key] ?? "");
  }
  return "";
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
