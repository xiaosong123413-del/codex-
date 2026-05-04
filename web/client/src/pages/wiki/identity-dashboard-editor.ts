/**
 * Editing controller for the personal identity dashboard.
 */
import { createWidget } from "./identity-dashboard-defaults.js";
import { renderIdentityDashboard } from "./identity-dashboard-view.js";
import type { IdentityDashboardConfig, IdentityDashboardWidget, IdentityWidgetType } from "./identity-dashboard-types.js";

interface IdentityDashboardEditorOptions {
  path: string;
  pageRaw: string;
  initialConfig: IdentityDashboardConfig;
  saveConfig(config: IdentityDashboardConfig): Promise<IdentityDashboardConfig>;
  afterRender(): Promise<void>;
}

interface EditorState {
  path: string;
  pageRaw: string;
  saved: IdentityDashboardConfig;
  draft: IdentityDashboardConfig;
  editing: boolean;
  selectedId: string;
  preview: IdentityDashboardWidget | null;
  saving: boolean;
  status: string;
  dragOffset: { x: number; y: number } | null;
}

const WIDGET_TYPES: Array<[IdentityWidgetType, string]> = [
  ["hero", "个人头像与基本信息"],
  ["stage", "当前阶段概览表"],
  ["timeline", "人生时间线"],
  ["nav", "导航按钮组"],
  ["relations", "人际关系总览图"],
  ["dreams", "梦境列表"],
  ["health", "健康与睡眠指标"],
  ["mood", "情绪与能量状态"],
  ["goals", "目标与价值观"],
  ["metaphysics", "命理与传统解释系统"],
  ["text", "自定义文本"],
  ["table", "自定义表格"],
  ["list", "自定义列表"],
];

export function createIdentityDashboardEditor(
  root: HTMLElement,
  options: IdentityDashboardEditorOptions,
): void {
  const state: EditorState = {
    path: options.path,
    pageRaw: options.pageRaw,
    saved: cloneConfig(options.initialConfig),
    draft: cloneConfig(options.initialConfig),
    editing: false,
    selectedId: options.initialConfig.widgets[0]?.id ?? "",
    preview: null,
    saving: false,
    status: "",
    dragOffset: null,
  };
  render(root, state, options);
}

function render(root: HTMLElement, state: EditorState, options: IdentityDashboardEditorOptions): void {
  root.classList.toggle("is-editing", state.editing);
  root.innerHTML = `
    <header class="identity-info-page__topbar">
      <div class="identity-info-page__search">搜索人物、事件、想法、笔记...</div>
      <div class="identity-info-page__actions">
        ${state.editing ? `
          <button type="button" data-identity-dashboard-cancel>取消</button>
          <button type="button" data-identity-dashboard-save>${state.saving ? "保存中..." : "保存页面"}</button>
        ` : `<button type="button" data-identity-dashboard-edit>编辑</button>`}
      </div>
    </header>
    <div class="identity-info-page__workspace">
      ${renderIdentityDashboard(state.draft, state.editing, state.selectedId)}
      ${state.editing ? renderEditorSidebar(state) : ""}
    </div>
  `;
  bind(root, state, options);
  void options.afterRender();
}

function renderEditorSidebar(state: EditorState): string {
  const selected = findSelectedWidget(state);
  return `
    <aside class="identity-info-page__editor" data-identity-dashboard-editor>
      <h2>组件库</h2>
      <div class="identity-info-page__library">
        ${WIDGET_TYPES.map(([type, label]) => `<button type="button" data-identity-add-widget="${type}">${label}</button>`).join("")}
      </div>
      <h2>属性</h2>
      ${selected ? renderWidgetEditor(selected, state) : "<p>选择一个组件后编辑。</p>"}
      <p class="identity-info-page__editor-status">${escapeHtml(state.status)}</p>
    </aside>
  `;
}

function renderWidgetEditor(widget: IdentityDashboardWidget, state: EditorState): string {
  return `
    <label>标题<input data-identity-widget-title value="${escapeHtml(widget.title)}" /></label>
    <div class="identity-info-page__layout-fields">
      ${["x", "y", "w", "h"].map((key) => `<label>${key}<input type="number" min="0" max="12" data-identity-widget-layout="${key}" value="${widget.layout[key as keyof typeof widget.layout]}" /></label>`).join("")}
    </div>
    <label>来源类型
      <select data-identity-widget-source-kind>
        ${["manual", "ai", "sync"].map((kind) => `<option value="${kind}" ${widget.source.kind === kind ? "selected" : ""}>${sourceLabel(kind)}</option>`).join("")}
      </select>
    </label>
    <label>来源说明<input data-identity-widget-source-note value="${escapeHtml(widget.source.note)}" /></label>
    <label>来源路径<input data-identity-widget-source-path value="${escapeHtml(widget.source.path ?? "")}" /></label>
    <label>结构化字段<textarea data-identity-widget-data>${escapeHtml(JSON.stringify(widget.data, null, 2))}</textarea></label>
    <div class="identity-info-page__editor-actions">
      <button type="button" data-identity-widget-delete>删除</button>
      <button type="button" data-identity-widget-duplicate>复制</button>
    </div>
    <h2>AI 生成</h2>
    <textarea data-identity-widget-prompt placeholder="告诉 AI 这个组件应该怎么改"></textarea>
    <button type="button" data-identity-widget-generate>生成预览</button>
    ${state.preview ? renderAiPreview(state.preview) : ""}
  `;
}

function renderAiPreview(widget: IdentityDashboardWidget): string {
  return `
    <div class="identity-info-page__ai-preview">
      <strong>生成预览</strong>
      <pre>${escapeHtml(JSON.stringify({ title: widget.title, data: widget.data }, null, 2))}</pre>
      <button type="button" data-identity-widget-apply-preview>应用到草稿</button>
    </div>
  `;
}

function bind(root: HTMLElement, state: EditorState, options: IdentityDashboardEditorOptions): void {
  root.querySelector<HTMLButtonElement>("[data-identity-dashboard-edit]")?.addEventListener("click", () => {
    state.editing = true;
    render(root, state, options);
  });
  root.querySelector<HTMLButtonElement>("[data-identity-dashboard-cancel]")?.addEventListener("click", () => {
    state.editing = false;
    state.draft = cloneConfig(state.saved);
    state.preview = null;
    render(root, state, options);
  });
  root.querySelector<HTMLButtonElement>("[data-identity-dashboard-save]")?.addEventListener("click", () => {
    void saveDashboard(root, state, options);
  });
  bindWidgetSelection(root, state, options);
  bindWidgetEditor(root, state, options);
  bindWidgetDrag(root, state, options);
  bindWidgetResize(root, state, options);
}

function bindWidgetSelection(root: HTMLElement, state: EditorState, options: IdentityDashboardEditorOptions): void {
  root.querySelectorAll<HTMLElement>("[data-identity-widget]").forEach((widgetNode) => {
    widgetNode.addEventListener("click", (event) => {
      if (!state.editing || shouldKeepWidgetInteraction(event.target)) return;
      state.selectedId = widgetNode.dataset.identityWidget ?? "";
      state.preview = null;
      render(root, state, options);
    });
  });
}

function bindWidgetEditor(root: HTMLElement, state: EditorState, options: IdentityDashboardEditorOptions): void {
  const selected = findSelectedWidget(state);
  if (!selected) return;
  root.querySelectorAll<HTMLElement>("[data-identity-field]").forEach((field) => {
    field.addEventListener("click", (event) => event.stopPropagation());
    field.addEventListener("mousedown", (event) => event.stopPropagation());
    field.addEventListener("input", () => {
      const widget = findWidgetForNode(state, field);
      if (widget) updateWidgetDataPath(widget, field.dataset.identityField ?? "", field.textContent ?? "");
    });
    field.addEventListener("focus", () => {
      const widget = findWidgetForNode(state, field);
      if (widget) state.selectedId = widget.id;
    });
    field.addEventListener("blur", () => {
      const widget = findWidgetForNode(state, field);
      if (widget) updateWidgetDataPath(widget, field.dataset.identityField ?? "", field.textContent ?? "");
    });
  });
  bindWidgetPropertyInputs(root, selected, state, options);
  root.querySelectorAll<HTMLButtonElement>("[data-identity-add-widget]").forEach((button) => {
    button.addEventListener("click", () => addWidget(root, state, options, button.dataset.identityAddWidget as IdentityWidgetType));
  });
  root.querySelector<HTMLButtonElement>("[data-identity-widget-delete]")?.addEventListener("click", () => deleteWidget(root, state, options));
  root.querySelector<HTMLButtonElement>("[data-identity-widget-duplicate]")?.addEventListener("click", () => duplicateWidget(root, state, options, selected));
  root.querySelector<HTMLButtonElement>("[data-identity-widget-generate]")?.addEventListener("click", () => {
    void generatePreview(root, state, options, selected);
  });
  root.querySelector<HTMLButtonElement>("[data-identity-widget-apply-preview]")?.addEventListener("click", () => applyPreview(root, state, options));
}

function bindWidgetPropertyInputs(
  root: HTMLElement,
  widget: IdentityDashboardWidget,
  state: EditorState,
  options: IdentityDashboardEditorOptions,
): void {
  root.querySelector<HTMLInputElement>("[data-identity-widget-title]")?.addEventListener("input", (event) => {
    widget.title = (event.currentTarget as HTMLInputElement).value;
  });
  root.querySelectorAll<HTMLInputElement>("[data-identity-widget-layout]").forEach((input) => {
    input.addEventListener("input", () => {
      const key = input.dataset.identityWidgetLayout as keyof typeof widget.layout;
      widget.layout[key] = Number(input.value);
      render(root, state, options);
    });
  });
  root.querySelector<HTMLSelectElement>("[data-identity-widget-source-kind]")?.addEventListener("change", (event) => {
    widget.source.kind = (event.currentTarget as HTMLSelectElement).value as typeof widget.source.kind;
  });
  root.querySelector<HTMLInputElement>("[data-identity-widget-source-note]")?.addEventListener("input", (event) => {
    widget.source.note = (event.currentTarget as HTMLInputElement).value;
  });
  root.querySelector<HTMLInputElement>("[data-identity-widget-source-path]")?.addEventListener("input", (event) => {
    widget.source.path = (event.currentTarget as HTMLInputElement).value;
  });
  root.querySelector<HTMLTextAreaElement>("[data-identity-widget-data]")?.addEventListener("change", (event) => {
    updateDataFromJson(widget, (event.currentTarget as HTMLTextAreaElement).value, state);
  });
}

function bindWidgetDrag(root: HTMLElement, state: EditorState, options: IdentityDashboardEditorOptions): void {
  root.querySelectorAll<HTMLElement>("[data-identity-widget]").forEach((widgetNode) => {
    widgetNode.addEventListener("dragstart", (event) => {
      if (shouldKeepWidgetInteraction(event.target)) {
        event.preventDefault();
        return;
      }
      const rect = widgetNode.getBoundingClientRect();
      state.dragOffset = {
        x: Math.max(0, event.clientX - rect.left),
        y: Math.max(0, event.clientY - rect.top),
      };
      event.dataTransfer?.setData("text/plain", widgetNode.dataset.identityWidget ?? "");
    });
    widgetNode.addEventListener("dragend", () => {
      state.dragOffset = null;
    });
  });
  root.querySelector<HTMLElement>("[data-identity-dashboard-canvas]")?.addEventListener("dragover", (event) => event.preventDefault());
  root.querySelector<HTMLElement>("[data-identity-dashboard-canvas]")?.addEventListener("drop", (event) => {
    event.preventDefault();
    const id = event.dataTransfer?.getData("text/plain") ?? "";
    const widget = state.draft.widgets.find((item) => item.id === id);
    const canvas = event.currentTarget as HTMLElement;
    if (!widget) return;
    const rect = canvas.getBoundingClientRect();
    const offset = state.dragOffset ?? { x: 0, y: 0 };
    const cellWidth = rect.width > 0 ? rect.width / 12 : 1;
    const rowHeight = rect.height > 0 ? rect.height / 8 : 1;
    widget.layout.x = clamp(Math.round((event.clientX - rect.left - offset.x) / cellWidth), 0, 12 - widget.layout.w);
    widget.layout.y = clamp(Math.round((event.clientY - rect.top - offset.y) / rowHeight), 0, 8 - widget.layout.h);
    state.selectedId = widget.id;
    state.dragOffset = null;
    render(root, state, options);
  });
}

function bindWidgetResize(root: HTMLElement, state: EditorState, options: IdentityDashboardEditorOptions): void {
  root.querySelectorAll<HTMLButtonElement>("[data-identity-widget-resize]").forEach((handle) => {
    handle.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const widgetId = handle.closest<HTMLElement>("[data-identity-widget]")?.dataset.identityWidget ?? "";
      const widget = state.draft.widgets.find((item) => item.id === widgetId) ?? null;
      if (!widget) return;
      state.selectedId = widget.id;
      const startX = event.clientX;
      const startY = event.clientY;
      const startW = widget.layout.w;
      const startH = widget.layout.h;
      const move = (moveEvent: MouseEvent) => {
        widget.layout.w = clamp(startW + Math.round((moveEvent.clientX - startX) / 80), 2, 12);
        widget.layout.h = clamp(startH + Math.round((moveEvent.clientY - startY) / 70), 1, 8);
      };
      const stop = () => {
        window.removeEventListener("mousemove", move);
        render(root, state, options);
      };
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", stop, { once: true });
    });
  });
}

function shouldKeepWidgetInteraction(target: EventTarget | null): boolean {
  return Boolean((target as HTMLElement | null)?.closest("[data-identity-field], input, textarea, select, button"));
}

function findWidgetForNode(state: EditorState, node: HTMLElement): IdentityDashboardWidget | null {
  const widgetId = node.closest<HTMLElement>("[data-identity-widget]")?.dataset.identityWidget ?? "";
  return state.draft.widgets.find((widget) => widget.id === widgetId) ?? null;
}

async function saveDashboard(root: HTMLElement, state: EditorState, options: IdentityDashboardEditorOptions): Promise<void> {
  state.saving = true;
  state.status = "正在保存...";
  render(root, state, options);
  try {
    state.saved = cloneConfig(await options.saveConfig(state.draft));
    state.draft = cloneConfig(state.saved);
    state.editing = false;
    state.status = "已保存";
  } catch {
    state.status = "保存失败";
  } finally {
    state.saving = false;
    render(root, state, options);
  }
}

async function generatePreview(
  root: HTMLElement,
  state: EditorState,
  options: IdentityDashboardEditorOptions,
  widget: IdentityDashboardWidget,
): Promise<void> {
  const prompt = root.querySelector<HTMLTextAreaElement>("[data-identity-widget-prompt]")?.value ?? "";
  const response = await fetch("/api/wiki/identity-dashboard/widget-generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ widget, prompt, pageRaw: state.pageRaw }),
  });
  const payload = await response.json() as { success?: boolean; data?: { widget: IdentityDashboardWidget } };
  state.preview = response.ok && payload.success !== false && payload.data?.widget ? payload.data.widget : null;
  state.status = state.preview ? "已生成预览" : "生成失败";
  render(root, state, options);
}

function applyPreview(root: HTMLElement, state: EditorState, options: IdentityDashboardEditorOptions): void {
  if (!state.preview) return;
  const index = state.draft.widgets.findIndex((widget) => widget.id === state.preview?.id);
  if (index >= 0) state.draft.widgets[index] = state.preview;
  state.preview = null;
  state.status = "预览已应用到草稿";
  render(root, state, options);
}

function addWidget(root: HTMLElement, state: EditorState, options: IdentityDashboardEditorOptions, type: IdentityWidgetType): void {
  const widget = createWidget(type);
  state.draft.widgets.push(widget);
  state.selectedId = widget.id;
  render(root, state, options);
}

function deleteWidget(root: HTMLElement, state: EditorState, options: IdentityDashboardEditorOptions): void {
  state.draft.widgets = state.draft.widgets.filter((widget) => widget.id !== state.selectedId);
  state.selectedId = state.draft.widgets[0]?.id ?? "";
  render(root, state, options);
}

function duplicateWidget(root: HTMLElement, state: EditorState, options: IdentityDashboardEditorOptions, widget: IdentityDashboardWidget): void {
  const copy = { ...cloneWidget(widget), id: `${widget.type}-${Date.now()}`, title: `${widget.title} 副本` };
  state.draft.widgets.push(copy);
  state.selectedId = copy.id;
  render(root, state, options);
}

function updateDataFromJson(widget: IdentityDashboardWidget, raw: string, state: EditorState): void {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      widget.data = parsed as Record<string, unknown>;
      state.status = "";
    }
  } catch {
    state.status = "结构化字段不是合法 JSON";
  }
}

function updateWidgetDataPath(widget: IdentityDashboardWidget, path: string, value: string): void {
  const parts = path.split(".").filter(Boolean);
  let cursor: unknown = widget.data;
  for (let index = 0; index < parts.length - 1; index += 1) {
    cursor = readPathPart(cursor, parts[index]!);
  }
  if (cursor && typeof cursor === "object") {
    (cursor as Record<string, unknown>)[parts.at(-1)!] = value;
  }
}

function readPathPart(value: unknown, part: string): unknown {
  if (Array.isArray(value)) return value[Number(part)];
  return value && typeof value === "object" ? (value as Record<string, unknown>)[part] : undefined;
}

function findSelectedWidget(state: EditorState): IdentityDashboardWidget | null {
  return state.draft.widgets.find((widget) => widget.id === state.selectedId) ?? state.draft.widgets[0] ?? null;
}

function cloneConfig(config: IdentityDashboardConfig): IdentityDashboardConfig {
  return JSON.parse(JSON.stringify(config)) as IdentityDashboardConfig;
}

function cloneWidget(widget: IdentityDashboardWidget): IdentityDashboardWidget {
  return JSON.parse(JSON.stringify(widget)) as IdentityDashboardWidget;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function sourceLabel(kind: string): string {
  if (kind === "ai") return "AI 生成";
  if (kind === "sync") return "同步来源";
  return "手写";
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
