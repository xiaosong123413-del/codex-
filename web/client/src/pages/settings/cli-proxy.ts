/**
 * CLIProxy settings UI helpers.
 *
 * This module isolates the built-in proxy/OAuth account controls from the main
 * settings page so the page file can stay focused on cross-panel state and
 * orchestration.
 */

import { readSettingsJsonPayload } from "./json.js";

interface CLIProxyAccountResponse {
  name: string;
  provider: string;
  email?: string;
  status?: string;
  statusMessage?: string;
  disabled?: boolean;
  planType?: string;
}

interface CLIProxyStatusResponse {
  running: boolean;
  proxyBaseUrl: string;
  config?: {
    proxyUrl?: string;
  };
  accounts: CLIProxyAccountResponse[];
  message?: string;
}

interface CLIProxyOAuthStatusResponse {
  status: "ok" | "wait" | "error";
  error?: string;
}

export interface CLIProxyOAuthAccountResponse extends CLIProxyAccountResponse {
  enabled: boolean;
  authIndex?: string;
  quota?: {
    fetchedAt: string;
    primaryWindow?: CLIProxyCodexQuotaWindowResponse;
    secondaryWindow?: CLIProxyCodexQuotaWindowResponse;
    error?: string;
  };
}

interface CLIProxyModelDescriptorResponse {
  id: string;
  displayName?: string;
  type?: string;
  ownedBy?: string;
}

interface CLIProxyCodexQuotaWindowResponse {
  usedPercent: number | null;
  resetsAt: string | null;
}

type OAuthAccountRefresh = (
  root: HTMLElement,
  oauthAccounts?: readonly CLIProxyOAuthAccountResponse[],
) => Promise<void>;

export function renderCLIProxyPanel(): string {
  return `
    <article class="settings-card settings-card--cliproxy">
      <div class="settings-card__header">
        <div>
          <div class="eyebrow">CLIPROXYAPI</div>
          <h2>Wiki &#x5185;&#x7f6e;&#x4ee3;&#x7406;&#x4e0e;&#x591a;&#x8d26;&#x53f7;</h2>
          <p class="settings-card__hint">用于 Codex、OAuth、多账号和本地代理统一出口。</p>
        </div>
        <button
          type="button"
          class="btn btn-secondary btn-inline settings-card__toggle"
          data-cliproxy-toggle
          aria-expanded="false"
          aria-controls="settings-cliproxy-body"
        >
          <span class="settings-card__toggle-icon" data-cliproxy-toggle-icon>›</span>
          <span data-cliproxy-toggle-label>展开</span>
        </button>
      </div>
      <div class="settings-card__body" id="settings-cliproxy-body" data-cliproxy-body hidden>
        <p data-cliproxy-status>&#x7531; Wiki &#x81ea;&#x5df1;&#x7ba1;&#x7406; OAuth&#x3001;&#x591a;&#x8d26;&#x53f7;&#x3001;&#x672c;&#x5730;&#x4ee3;&#x7406;&#x542f;&#x505c;&#x3002;</p>
        <div class="settings-run-panel__actions">
          <button type="button" class="btn btn-secondary" data-cliproxy-install>&#x5b89;&#x88c5; / &#x66f4;&#x65b0;&#x5f15;&#x64ce;</button>
          <button type="button" class="btn btn-primary" data-cliproxy-start>&#x542f;&#x52a8;&#x4ee3;&#x7406;</button>
          <button type="button" class="btn btn-secondary" data-cliproxy-stop>&#x505c;&#x6b62;</button>
          <button type="button" class="btn btn-secondary" data-cliproxy-refresh>&#x5237;&#x65b0;&#x8d26;&#x53f7;</button>
        </div>
        <div class="settings-provider-fields">
          <label class="settings-field"><span>CLIProxyAPI 出站代理 URL</span><input data-cliproxy-proxy-url type="text" placeholder="http://127.0.0.1:7890" /></label>
        </div>
        <div class="settings-run-panel__actions">
          <button type="button" class="btn btn-secondary" data-cliproxy-oauth="codex">Codex OAuth</button>
          <button type="button" class="btn btn-secondary" data-cliproxy-oauth="anthropic">Claude OAuth</button>
          <button type="button" class="btn btn-secondary" data-cliproxy-oauth="gemini-cli">Gemini CLI OAuth</button>
          <button type="button" class="btn btn-secondary" data-cliproxy-oauth="kimi">Kimi OAuth</button>
          <button type="button" class="btn btn-secondary" data-cliproxy-oauth-copy hidden>复制授权链接</button>
        </div>
        <div class="settings-provider-fields">
          <label class="settings-field"><span>OpenAI-compatible &#x540d;&#x79f0;</span><input data-cliproxy-openai="name" type="text" value="custom" /></label>
          <label class="settings-field"><span>&#x4e0a;&#x6e38; Base URL</span><input data-cliproxy-openai="baseUrl" type="text" /></label>
          <label class="settings-field"><span>&#x4e0a;&#x6e38; API Key</span><input data-cliproxy-openai="apiKey" type="password" /></label>
          <label class="settings-field"><span>&#x6a21;&#x578b; / Alias</span><input data-cliproxy-openai="model" type="text" /></label>
        </div>
        <button type="button" class="btn btn-secondary" data-cliproxy-openai-save>&#x5bfc;&#x5165;&#x4e0a;&#x6e38;&#x8d26;&#x53f7;</button>
        <div class="settings-run-panel__summary" data-cliproxy-accounts>
          <span class="settings-run-panel__chip">&#x6682;&#x672a;&#x8bfb;&#x53d6;&#x8d26;&#x53f7;</span>
        </div>
        <div class="settings-codex-accounts">
          <div class="settings-codex-accounts__header">
            <button type="button" class="settings-codex-accounts__toggle" data-cliproxy-codex-toggle aria-expanded="true">
              <span>⌄</span>
              <strong>OAuth 账号</strong>
            </button>
            <button type="button" class="btn btn-secondary btn-inline" data-cliproxy-codex-refresh>刷新账号 / Codex 额度</button>
          </div>
          <div class="settings-codex-accounts__list" data-cliproxy-codex-accounts>
            <div class="settings-source-empty">暂无 OAuth 账号</div>
          </div>
        </div>
      </div>
    </article>
  `;
}

function bindCLIProxyControls(root: HTMLElement, refreshOAuthAccounts: OAuthAccountRefresh): void {
  root.querySelector<HTMLButtonElement>("[data-cliproxy-toggle]")?.addEventListener("click", () => {
    toggleCLIProxySection(root);
  });
  root.querySelector<HTMLButtonElement>("[data-cliproxy-install]")?.addEventListener("click", () => {
    void postCLIProxyAction(root, refreshOAuthAccounts, "/api/cliproxy/install");
  });
  root.querySelector<HTMLButtonElement>("[data-cliproxy-start]")?.addEventListener("click", () => {
    void postCLIProxyAction(root, refreshOAuthAccounts, "/api/cliproxy/start", { proxyUrl: readCLIProxyProxyUrl(root) });
  });
  root.querySelector<HTMLButtonElement>("[data-cliproxy-stop]")?.addEventListener("click", () => {
    void postCLIProxyAction(root, refreshOAuthAccounts, "/api/cliproxy/stop");
  });
  root.querySelector<HTMLButtonElement>("[data-cliproxy-refresh]")?.addEventListener("click", () => {
    void hydrateCLIProxyStatus(root, refreshOAuthAccounts);
  });
  root.querySelector<HTMLButtonElement>("[data-cliproxy-codex-refresh]")?.addEventListener("click", () => {
    void hydrateCLIProxyCodexAccounts(root, refreshOAuthAccounts, true);
  });
  root.querySelector<HTMLButtonElement>("[data-cliproxy-codex-toggle]")?.addEventListener("click", (event) => {
    toggleCLIProxyCodexAccounts(root, event.currentTarget as HTMLButtonElement);
  });
  root.querySelectorAll<HTMLButtonElement>("[data-cliproxy-oauth]").forEach((button) => {
    button.addEventListener("click", () => {
      void startCLIProxyOAuth(root, refreshOAuthAccounts, button.dataset.cliproxyOauth ?? "");
    });
  });
  root.querySelector<HTMLButtonElement>("[data-cliproxy-oauth-copy]")?.addEventListener("click", () => {
    void copyCLIProxyOAuthLink(root);
  });
  root.querySelector<HTMLButtonElement>("[data-cliproxy-openai-save]")?.addEventListener("click", () => {
    void saveCLIProxyOpenAICompatibility(root);
  });
}

export async function fetchCLIProxyOAuthAccounts(refreshQuota: boolean): Promise<CLIProxyOAuthAccountResponse[]> {
  try {
    const url = `/api/cliproxy/accounts${refreshQuota ? "?refresh=1" : ""}`;
    const response = await fetch(url);
    const payload = await readJsonPayload<{ success?: boolean; data?: { accounts?: CLIProxyOAuthAccountResponse[] }; error?: string }>(response);
    if (!response.ok || !payload.success || !payload.data?.accounts) {
      throw new Error(payload.error ?? "OAuth 账号读取失败");
    }
    return payload.data.accounts;
  } catch {
    return fetchCLIProxyOAuthAccountsFallback(refreshQuota);
  }
}

async function readJsonPayload<T>(response: Response): Promise<T> {
  return readSettingsJsonPayload<T>(response);
}

export async function fetchCLIProxyAccountModels(name: string): Promise<string[]> {
  const response = await fetch(`/api/cliproxy/accounts/models?name=${encodeURIComponent(name)}`);
  const payload = await readJsonPayload<{ success?: boolean; data?: { models?: CLIProxyModelDescriptorResponse[] }; error?: string }>(response);
  if (!response.ok || !payload.success || !payload.data?.models) {
    return [];
  }
  return payload.data.models.map((model) => model.id).filter(Boolean);
}

export function formatCLIProxyProvider(provider: string): string {
  switch (provider) {
    case "codex":
      return "Codex";
    case "gemini-cli":
    case "gemini":
      return "Gemini";
    case "anthropic":
      return "Claude";
    case "kimi":
      return "Kimi";
    case "antigravity":
      return "Antigravity";
    default:
      return provider;
  }
}

function toggleCLIProxySection(root: HTMLElement): void {
  const button = root.querySelector<HTMLButtonElement>("[data-cliproxy-toggle]");
  const body = root.querySelector<HTMLElement>("[data-cliproxy-body]");
  const icon = root.querySelector<HTMLElement>("[data-cliproxy-toggle-icon]");
  const label = root.querySelector<HTMLElement>("[data-cliproxy-toggle-label]");
  if (!button || !body) return;
  const nextExpanded = button.getAttribute("aria-expanded") !== "true";
  button.setAttribute("aria-expanded", String(nextExpanded));
  body.hidden = !nextExpanded;
  if (icon) icon.textContent = nextExpanded ? "⌄" : "›";
  if (label) label.textContent = nextExpanded ? "收起" : "展开";
}

export async function postCLIProxyAction(
  root: HTMLElement,
  refreshOAuthAccounts: OAuthAccountRefresh,
  url: string,
  body?: Record<string, string>,
): Promise<void> {
  const status = root.querySelector<HTMLElement>("[data-cliproxy-status]");
  if (status) status.textContent = "正在执行...";
  try {
    const response = await fetch(url, body
      ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
      : { method: "POST" });
    const payload = (await response.json()) as { success?: boolean; data?: { message?: string }; error?: string };
    if (!response.ok || !payload.success) {
      throw new Error(payload.error ?? "CLIProxyAPI 操作失败");
    }
    if (status) status.textContent = payload.data?.message ?? "操作完成。";
    await hydrateCLIProxyStatus(root, refreshOAuthAccounts);
    await hydrateCLIProxyCodexAccounts(root, refreshOAuthAccounts, false);
  } catch (error) {
    if (status) status.textContent = error instanceof Error ? error.message : String(error);
  }
}

async function hydrateCLIProxyStatus(root: HTMLElement, refreshOAuthAccounts: OAuthAccountRefresh): Promise<void> {
  const status = root.querySelector<HTMLElement>("[data-cliproxy-status]");
  try {
    const response = await fetch("/api/cliproxy/status");
    const payload = (await response.json()) as { success?: boolean; data?: CLIProxyStatusResponse; error?: string };
    if (!response.ok || !payload.success || !payload.data) {
      throw new Error(payload.error ?? "CLIProxyAPI 状态读取失败");
    }
    renderCLIProxyStatus(root, refreshOAuthAccounts, payload.data);
  } catch (error) {
    if (status) status.textContent = error instanceof Error ? error.message : String(error);
  }
}

function renderCLIProxyStatus(
  root: HTMLElement,
  refreshOAuthAccounts: OAuthAccountRefresh,
  data: CLIProxyStatusResponse,
): void {
  const status = root.querySelector<HTMLElement>("[data-cliproxy-status]");
  const accounts = root.querySelector<HTMLElement>("[data-cliproxy-accounts]");
  const proxyInput = root.querySelector<HTMLInputElement>("[data-cliproxy-proxy-url]");
  if (status) {
    status.textContent = data.running ? `代理运行中：${data.proxyBaseUrl}` : data.message ?? "CLIProxyAPI 未运行。";
  }
  if (accounts) {
    accounts.innerHTML = data.accounts.length > 0
      ? data.accounts.map((account) => `<span class="settings-run-panel__chip">${escapeHtml(formatCLIProxyAccount(account))}</span>`).join("")
      : `<span class="settings-run-panel__chip">暂无账号</span>`;
  }
  if (proxyInput && data.config?.proxyUrl) {
    proxyInput.value = data.config.proxyUrl;
  }
  void hydrateCLIProxyCodexAccounts(root, refreshOAuthAccounts, false);
}

export async function startCLIProxyOAuth(
  root: HTMLElement,
  refreshOAuthAccounts: OAuthAccountRefresh,
  provider: string,
): Promise<void> {
  const status = root.querySelector<HTMLElement>("[data-cliproxy-status]");
  if (status) status.textContent = "正在创建 OAuth 登录链接...";
  try {
    const response = await fetch("/api/cliproxy/oauth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider }),
    });
    const payload = (await response.json()) as { success?: boolean; data?: { url?: string; state?: string }; error?: string };
    if (!response.ok || !payload.success || !payload.data?.url || !payload.data.state) {
      throw new Error(payload.error ?? "OAuth 登录链接创建失败");
    }
    renderCLIProxyOAuthCopyButton(root, payload.data.url);
    await openExternalUrl(payload.data.url);
    if (status) status.textContent = `OAuth 已打开，等待 ${provider} 登录完成...`;
    await waitForCLIProxyOAuth(root, refreshOAuthAccounts, provider, payload.data.state);
  } catch (error) {
    if (status) status.textContent = error instanceof Error ? error.message : String(error);
  }
}

function renderCLIProxyOAuthCopyButton(root: HTMLElement, url: string): void {
  const copyButton = root.querySelector<HTMLButtonElement>("[data-cliproxy-oauth-copy]");
  if (!copyButton) return;
  copyButton.hidden = false;
  copyButton.dataset.oauthUrl = url;
}

async function copyCLIProxyOAuthLink(root: HTMLElement): Promise<void> {
  const status = root.querySelector<HTMLElement>("[data-cliproxy-status]");
  const copyButton = root.querySelector<HTMLButtonElement>("[data-cliproxy-oauth-copy]");
  const url = copyButton?.dataset.oauthUrl;
  if (!url) {
    if (status) status.textContent = "暂无可复制的 OAuth 链接，请先点击登录。";
    return;
  }
  try {
    await navigator.clipboard.writeText(url);
    if (status) status.textContent = "OAuth 链接已复制。";
  } catch {
    if (status) status.textContent = url;
  }
}

async function openExternalUrl(url: string): Promise<void> {
  if (window.llmWikiDesktop?.openExternal) {
    await window.llmWikiDesktop.openExternal(url);
    return;
  }
  window.open(url, "_blank", "noopener");
}

export async function waitForCLIProxyOAuth(
  root: HTMLElement,
  refreshOAuthAccounts: OAuthAccountRefresh,
  provider: string,
  state: string,
): Promise<void> {
  const status = root.querySelector<HTMLElement>("[data-cliproxy-status]");
  for (let attempt = 0; attempt < 150; attempt += 1) {
    const response = await fetch(`/api/cliproxy/oauth/status?state=${encodeURIComponent(state)}`);
    const payload = (await response.json()) as { success?: boolean; data?: CLIProxyOAuthStatusResponse; error?: string };
    if (!response.ok || !payload.success || !payload.data) {
      throw new Error(payload.error ?? "OAuth 状态读取失败");
    }
    if (payload.data.status === "wait") {
      if (status) status.textContent = `等待 ${provider} 登录完成...`;
      await sleep(2000);
      continue;
    }
    if (payload.data.status === "error") {
      throw new Error(payload.data.error ?? "OAuth 登录失败");
    }
    if (status) status.textContent = `${provider} 登录完成，正在刷新账号...`;
    await hydrateCLIProxyStatus(root, refreshOAuthAccounts);
    await hydrateCLIProxyCodexAccounts(root, refreshOAuthAccounts, true);
    return;
  }
  throw new Error("OAuth 登录超时，请重新点击登录。");
}

async function hydrateCLIProxyCodexAccounts(
  root: HTMLElement,
  refreshOAuthAccounts: OAuthAccountRefresh,
  refreshQuota: boolean,
): Promise<void> {
  const list = root.querySelector<HTMLElement>("[data-cliproxy-codex-accounts]");
  const status = root.querySelector<HTMLElement>("[data-cliproxy-status]");
  if (!list) return;
  if (refreshQuota) list.innerHTML = `<div class="settings-source-empty">正在刷新 Codex 额度...</div>`;
  try {
    const accounts = await fetchCLIProxyOAuthAccounts(refreshQuota);
    renderCLIProxyCodexAccounts(root, refreshOAuthAccounts, accounts);
    void refreshOAuthAccounts(root, accounts);
    if (refreshQuota && status) status.textContent = "OAuth 账号已刷新，Codex 剩余额度已更新。";
  } catch (error) {
    list.innerHTML = `<div class="settings-source-empty">${escapeHtml(error instanceof Error ? error.message : String(error))}</div>`;
    void refreshOAuthAccounts(root, []);
  }
}

async function fetchCLIProxyOAuthAccountsFallback(refreshQuota: boolean): Promise<CLIProxyOAuthAccountResponse[]> {
  const response = await fetch("/api/cliproxy/status");
  const payload = await readJsonPayload<{ success?: boolean; data?: CLIProxyStatusResponse; error?: string }>(response);
  if (!response.ok || !payload.success || !payload.data?.accounts) {
    throw new Error(payload.error ?? "OAuth 账号读取失败");
  }
  const accounts = payload.data.accounts.map((account) => ({
    ...account,
    enabled: account.disabled !== true,
  }));
  return refreshQuota ? mergeCodexQuotaFallback(accounts) : accounts;
}

async function mergeCodexQuotaFallback(
  accounts: CLIProxyOAuthAccountResponse[],
): Promise<CLIProxyOAuthAccountResponse[]> {
  try {
    const response = await fetch("/api/cliproxy/codex/accounts?refresh=1");
    const payload = await readSettingsJsonPayload<{ success?: boolean; data?: { accounts?: CLIProxyOAuthAccountResponse[] } }>(response);
    if (!response.ok || !payload.success || !payload.data?.accounts) return accounts;
    const codexByName = new Map(payload.data.accounts.map((account) => [account.name, account]));
    return accounts.map((account) => codexByName.get(account.name) ?? account);
  } catch {
    return accounts;
  }
}

function renderCLIProxyCodexAccounts(
  root: HTMLElement,
  refreshOAuthAccounts: OAuthAccountRefresh,
  accounts: CLIProxyOAuthAccountResponse[],
): void {
  const list = root.querySelector<HTMLElement>("[data-cliproxy-codex-accounts]");
  if (!list) return;
  if (accounts.length === 0) {
    list.innerHTML = `<div class="settings-source-empty">暂无 OAuth 账号</div>`;
    return;
  }
  list.innerHTML = accounts.map(renderCLIProxyCodexAccount).join("");
  list.querySelectorAll<HTMLInputElement>("[data-cliproxy-codex-enabled]").forEach((input) => {
    input.addEventListener("change", () => {
      void setCLIProxyCodexAccountEnabled(
        root,
        refreshOAuthAccounts,
        input.dataset.cliproxyCodexEnabled ?? "",
        input.checked,
      );
    });
  });
}

function renderCLIProxyCodexAccount(account: CLIProxyOAuthAccountResponse): string {
  const label = account.email ?? account.name;
  return `
    <div class="settings-codex-account">
      <label class="settings-codex-account__select">
        <input type="checkbox" data-cliproxy-codex-enabled="${escapeHtml(account.name)}" ${account.enabled ? "checked" : ""} />
        <span></span>
      </label>
      <div class="settings-codex-account__main">
        ${renderCLIProxyCodexAccountTitle(account, label)}
        <small>${escapeHtml(resolveCLIProxyCodexAccountStatus(account))}</small>
        ${renderCLIProxyCodexAccountError(account)}
      </div>
      <div class="settings-codex-account__quota">
        ${renderCodexQuotaTile("5h 剩余", account.quota?.primaryWindow)}
        ${renderCodexQuotaTile("1w 剩余", account.quota?.secondaryWindow)}
      </div>
    </div>
  `;
}

function renderCLIProxyCodexAccountTitle(account: CLIProxyOAuthAccountResponse, label: string): string {
  return `
    <div class="settings-codex-account__title">
      <strong>${escapeHtml(label)}</strong>
      <span>${escapeHtml(formatCLIProxyProvider(account.provider))}</span>
      ${renderCLIProxyCodexPlan(account.planType)}
    </div>
  `;
}

function renderCLIProxyCodexPlan(planType?: string): string {
  return planType ? `<span>${escapeHtml(planType)}</span>` : "";
}

function resolveCLIProxyCodexAccountStatus(account: CLIProxyOAuthAccountResponse): string {
  if (account.statusMessage) return account.statusMessage;
  if (account.status) return account.status;
  return account.enabled ? "可用" : "已停用";
}

function renderCLIProxyCodexAccountError(account: CLIProxyOAuthAccountResponse): string {
  return account.quota?.error
    ? `<div class="settings-codex-account__error">${escapeHtml(account.quota.error)}</div>`
    : "";
}

function renderCodexQuotaTile(label: string, windowData?: CLIProxyCodexQuotaWindowResponse): string {
  const width = getCodexRemainingPercent(windowData) ?? 0;
  return `
    <div class="settings-codex-account__quota-tile">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(formatCodexQuotaWindow(windowData))}</strong>
      <div class="settings-codex-account__quota-bar" aria-label="${escapeHtml(label)}">
        <span style="width:${width}%"></span>
      </div>
    </div>
  `;
}

function formatCodexQuotaWindow(windowData?: CLIProxyCodexQuotaWindowResponse): string {
  if (!windowData) return "--";
  const percent = typeof windowData.usedPercent === "number" ? `${getCodexRemainingPercent(windowData)}%` : "--";
  const reset = windowData.resetsAt ? ` / ${formatResetTime(windowData.resetsAt)}` : "";
  return `${percent}${reset}`;
}

function getCodexRemainingPercent(windowData?: CLIProxyCodexQuotaWindowResponse): number | null {
  if (typeof windowData?.usedPercent !== "number") return null;
  return clamp(Math.round(100 - windowData.usedPercent), 0, 100);
}

function toggleCLIProxyCodexAccounts(root: HTMLElement, button: HTMLButtonElement): void {
  const list = root.querySelector<HTMLElement>("[data-cliproxy-codex-accounts]");
  const icon = button.querySelector("span");
  if (!list) return;
  const nextCollapsed = !list.hidden;
  list.hidden = nextCollapsed;
  button.setAttribute("aria-expanded", String(!nextCollapsed));
  if (icon) icon.textContent = nextCollapsed ? "›" : "⌄";
}

function formatResetTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export async function setCLIProxyCodexAccountEnabled(
  root: HTMLElement,
  refreshOAuthAccounts: OAuthAccountRefresh,
  name: string,
  enabled: boolean,
): Promise<void> {
  const status = root.querySelector<HTMLElement>("[data-cliproxy-status]");
  try {
    const response = await fetch("/api/cliproxy/accounts/enabled", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, enabled }),
    });
    const payload = (await response.json()) as { success?: boolean; error?: string };
    if (!response.ok || !payload.success) throw new Error(payload.error ?? "OAuth 账号切换失败");
    if (status) status.textContent = enabled ? "OAuth 账号已启用。" : "OAuth 账号已停用。";
    await hydrateCLIProxyCodexAccounts(root, refreshOAuthAccounts, false);
  } catch (error) {
    if (status) status.textContent = error instanceof Error ? error.message : String(error);
    await hydrateCLIProxyCodexAccounts(root, refreshOAuthAccounts, false);
  }
}

async function saveCLIProxyOpenAICompatibility(root: HTMLElement): Promise<void> {
  const status = root.querySelector<HTMLElement>("[data-cliproxy-status]");
  if (status) status.textContent = "正在导入 OpenAI-compatible 上游...";
  try {
    const response = await fetch("/api/cliproxy/openai-compatibility", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: readCLIProxyOpenAIInput(root, "name"),
        baseUrl: readCLIProxyOpenAIInput(root, "baseUrl"),
        apiKey: readCLIProxyOpenAIInput(root, "apiKey"),
        model: readCLIProxyOpenAIInput(root, "model"),
      }),
    });
    const payload = (await response.json()) as { success?: boolean; error?: string };
    if (!response.ok || !payload.success) {
      throw new Error(payload.error ?? "上游账号导入失败");
    }
    if (status) status.textContent = "上游账号已导入。";
  } catch (error) {
    if (status) status.textContent = error instanceof Error ? error.message : String(error);
  }
}

function readCLIProxyOpenAIInput(root: HTMLElement, key: string): string {
  return root.querySelector<HTMLInputElement>(`[data-cliproxy-openai="${cssEscape(key)}"]`)?.value.trim() ?? "";
}

function readCLIProxyProxyUrl(root: HTMLElement): string {
  return root.querySelector<HTMLInputElement>("[data-cliproxy-proxy-url]")?.value.trim() ?? "";
}

function formatCLIProxyAccount(account: CLIProxyAccountResponse): string {
  return [account.provider, account.email ?? account.name, account.status].filter(Boolean).join(" · ");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replace(/[^a-zA-Z0-9_-]/g, (char) => `\\${char}`);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
