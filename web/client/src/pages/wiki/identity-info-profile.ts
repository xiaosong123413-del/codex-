/**
 * Dedicated editable dashboard page for the personal identity information
 * archive.
 */
import { renderWikiRelationGraph } from "./relation-graph.js";
import {
  buildDefaultIdentityDashboard,
  normalizeDashboardConfig,
  parseIdentityMarkdown,
} from "./identity-dashboard-defaults.js";
import { createIdentityDashboardEditor } from "./identity-dashboard-editor.js";
import type { IdentityDashboardConfig, IdentityInfoPageResponse } from "./identity-dashboard-types.js";

type DisposableNode = HTMLElement & {
  __dispose?: () => void;
};

interface DashboardApiResponse {
  success?: boolean;
  data?: {
    config: IdentityDashboardConfig | null;
  };
}

export function renderIdentityInfoProfilePage(path: string): HTMLElement {
  const root = document.createElement("section") as DisposableNode;
  const controller = new AbortController();
  root.className = "identity-info-page";
  root.innerHTML = renderLoading();
  root.__dispose = () => controller.abort();
  void loadIdentityInfo(root, path, controller.signal);
  return root;
}

async function loadIdentityInfo(root: HTMLElement, path: string, signal: AbortSignal): Promise<void> {
  try {
    const response = await fetchIdentityInfo(path, signal);
    if (!response || signal.aborted) {
      root.innerHTML = renderMissing(path);
      return;
    }
    const fallback = buildDefaultIdentityDashboard(path, parseIdentityMarkdown(response), response);
    const saved = await fetchDashboardConfig(path, signal);
    createIdentityDashboardEditor(root, {
      path,
      pageRaw: response.raw ?? "",
      initialConfig: normalizeDashboardConfig(saved, fallback),
      saveConfig: (config) => saveDashboardConfig(path, config),
      afterRender: async () => {
        bindAvatarPreview(root, path, signal);
        await hydrateRelationOverviewGraph(root, signal);
      },
    });
  } catch {
    if (!signal.aborted) root.innerHTML = renderMissing(path);
  }
}

async function fetchIdentityInfo(path: string, signal: AbortSignal): Promise<IdentityInfoPageResponse | null> {
  const response = await fetch(`/api/page?path=${encodeURIComponent(path)}&raw=1`, { signal });
  return response.ok ? (await response.json()) as IdentityInfoPageResponse : null;
}

async function fetchDashboardConfig(path: string, signal: AbortSignal): Promise<IdentityDashboardConfig | null> {
  const response = await fetch(`/api/wiki/identity-dashboard?path=${encodeURIComponent(path)}`, { signal });
  if (!response.ok) return null;
  const payload = await response.json() as DashboardApiResponse;
  return payload.success === false ? null : payload.data?.config ?? null;
}

async function saveDashboardConfig(path: string, config: IdentityDashboardConfig): Promise<IdentityDashboardConfig> {
  const response = await fetch("/api/wiki/identity-dashboard", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, config }),
  });
  const payload = await response.json() as DashboardApiResponse;
  if (!response.ok || payload.success === false || !payload.data?.config) {
    throw new Error("save dashboard failed");
  }
  return payload.data.config;
}

async function hydrateRelationOverviewGraph(root: HTMLElement, signal: AbortSignal): Promise<void> {
  const target = root.querySelector<HTMLElement>("[data-identity-relation-graph]");
  if (!target) return;
  const response = await fetchIdentityInfo("wiki/crm/人际关系总览.md", signal);
  if (!response?.raw || signal.aborted) return;
  const source = /```mermaid\s*([\s\S]*?)```/u.exec(response.raw)?.[1]?.trim();
  if (source) target.replaceChildren(renderWikiRelationGraph(source));
}

function bindAvatarPreview(root: HTMLElement, path: string, signal: AbortSignal): void {
  const openButton = root.querySelector<HTMLButtonElement>("[data-identity-avatar-open]");
  if (!openButton || openButton.dataset.identityAvatarBound === "true") return;
  const modal = renderAvatarModal(root);
  const closeButton = modal.querySelector<HTMLButtonElement>("[data-identity-avatar-close]");
  const changeButton = modal.querySelector<HTMLButtonElement>("[data-identity-avatar-change]");
  const input = modal.querySelector<HTMLInputElement>("[data-identity-avatar-input]");
  openButton.dataset.identityAvatarBound = "true";
  openButton.addEventListener("click", () => {
    modal.hidden = false;
  });
  closeButton?.addEventListener("click", () => {
    modal.hidden = true;
  });
  changeButton?.addEventListener("click", () => input?.click());
  input?.addEventListener("change", () => {
    const file = input.files?.[0];
    input.value = "";
    if (file) void uploadAvatar(root, path, file, signal);
  });
}

function renderAvatarModal(root: HTMLElement): HTMLElement {
  const existing = root.querySelector<HTMLElement>("[data-identity-avatar-modal]");
  if (existing) return existing;
  const image = root.querySelector<HTMLImageElement>(".identity-info-page__avatar img")?.getAttribute("src") ?? "";
  const modal = document.createElement("div");
  modal.className = "identity-info-page__avatar-modal";
  modal.dataset.identityAvatarModal = "";
  modal.hidden = true;
  modal.innerHTML = `
    <div class="identity-info-page__avatar-preview">
      <div class="identity-info-page__avatar-actions">
        <button type="button" data-identity-avatar-close>关闭</button>
        <button type="button" data-identity-avatar-change>更换图片</button>
        <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" data-identity-avatar-input hidden />
      </div>
      ${image ? `<img src="${image}" alt="头像预览" data-identity-avatar-preview />` : `<div class="identity-info-page__avatar-empty">还没有头像图片</div>`}
      <p data-identity-avatar-status></p>
    </div>
  `;
  root.appendChild(modal);
  return modal;
}

async function uploadAvatar(root: HTMLElement, path: string, file: File, signal: AbortSignal): Promise<void> {
  const status = root.querySelector<HTMLElement>("[data-identity-avatar-status]");
  if (status) status.textContent = "正在更换图片...";
  try {
    const dataUrl = await readFileAsDataUrl(file);
    const response = await fetch("/api/page-side-image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, fileName: file.name, dataUrl, frontmatterKey: "avatar_image" }),
      signal,
    });
    if (!response.ok) throw new Error("upload failed");
    await loadIdentityInfo(root, path, signal);
  } catch {
    if (status) status.textContent = "更换失败，请稍后再试。";
  }
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("file read failed"));
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("file read failed"));
    reader.readAsDataURL(file);
  });
}

function renderLoading(): string {
  return `<div class="identity-info-page__loading">正在加载个人信息中心...</div>`;
}

function renderMissing(path: string): string {
  return `<div class="identity-info-page__loading">没有找到 ${escapeHtml(path)}</div>`;
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
