import { renderIcon } from "../components/icon.js";

/** Render a fallback page for unknown route names. */
export function renderPlaceholder(routeName: string): HTMLElement {
  const root = document.createElement("div");
  root.className = "shell-placeholder";
  root.innerHTML = `
    <div class="shell-placeholder__card">
      <div class="shell-placeholder__icon">${renderIcon("hammer", { size: 32 })}</div>
      <h2 class="shell-placeholder__title">页面不存在</h2>
      <p class="shell-placeholder__copy">未知路由：${escapeHtml(routeName)}</p>
    </div>
  `;
  return root;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
