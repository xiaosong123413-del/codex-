// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderSettingsPage } from "../web/client/src/pages/settings/index.js";
import { openSettingsDialog } from "../web/client/src/pages/settings/settings-dialog.js";

afterEach(() => {
  vi.restoreAllMocks();
  delete (window as Window & { llmWikiDesktop?: unknown }).llmWikiDesktop;
  window.localStorage.clear();
  document.body.innerHTML = "";
  window.location.hash = "";
});

const nvidiaProviderResponses: Record<string, () => Response> = {
  "PUT /api/llm/accounts": () => jsonResponse({
    success: true,
    data: {
      id: "nvidia:main",
      name: "main",
      provider: "nvidia",
      url: "https://integrate.api.nvidia.com/v1",
      keyConfigured: true,
      model: "meta/llama-3.3-70b-instruct",
      enabled: true,
      updatedAt: "2026-05-02T00:00:00.000Z",
    },
  }),
  "PUT /api/llm/config": () => jsonResponse({
    success: true,
    data: {
      accountRef: "api:nvidia:main",
      provider: "nvidia",
      url: "https://integrate.api.nvidia.com/v1",
      keyConfigured: true,
      model: "meta/llama-3.3-70b-instruct",
    },
  }),
  "POST /api/llm/test": () => jsonResponse({
    success: true,
    data: {
      ok: true,
      provider: "nvidia",
      endpoint: "https://integrate.api.nvidia.com/v1/chat/completions",
      message: "验证成功，API 可以连通。",
    },
  }),
};

describe("settings page", () => {
  it("renders the LLM provider rebuild entry without legacy provider controls", () => {
    const page = renderSettingsPage();
    const llmPanel = page.querySelector<HTMLElement>("[data-settings-panel=\"llm\"]");

    expect(llmPanel).not.toBeNull();
    expect(llmPanel?.textContent).toContain("提供商");
    expect(llmPanel?.textContent).toContain("已添加 0 个提供商");
    expect(page.querySelector("[data-llm-provider-add]")).not.toBeNull();
    expect(page.querySelector("[data-llm-default-card]")).toBeNull();
    expect(page.querySelector("[data-llm-account-summary-card]")).toBeNull();
    expect(page.querySelector("[data-llm-provider=\"openai\"]")).toBeNull();
    expect(page.querySelector("[data-cliproxy-toggle]")).toBeNull();
  });

  // fallow-ignore-next-line complexity
  it("opens the custom provider form from the LLM provider entry", () => {
    const page = renderSettingsPage();
    document.body.appendChild(page);
    const dialog = page.querySelector<HTMLElement>("[data-llm-provider-dialog]");

    expect(dialog?.hidden).toBe(true);
    page.querySelector<HTMLButtonElement>("[data-llm-provider-add]")?.click();

    expect(dialog?.hidden).toBe(false);
    expect(dialog?.textContent).toContain("添加提供商");
    expect(page.querySelector("[data-llm-provider-field=\"id\"]")).not.toBeNull();
    const preset = page.querySelector<HTMLSelectElement>("[data-llm-provider-field=\"preset\"]");
    const apiType = page.querySelector<HTMLSelectElement>("[data-llm-provider-field=\"apiType\"]");
    const transport = page.querySelector<HTMLSelectElement>("[data-llm-provider-field=\"transport\"]");
    expect(Array.from(preset?.options ?? []).map((option) => option.value)).toEqual([
      "Anthropic (Claude)",
      "OpenAI (GPT)",
      "Google (Gemini)",
      "DeepSeek",
      "Groq",
      "xAI (Grok)",
      "NVIDIA NIM",
      "Kimi (Moonshot)",
      "Kimi (Moonshot, 中国)",
      "智谱 GLM (Zhipu)",
      "MiniMax (Global)",
      "MiniMax (中国)",
      "阿里百炼 Coding Plan",
      "小米 MiMo (Xiaomi)",
      "火山引擎 Ark (Volcengine)",
      "小马 / 神马中转",
      "Ollama (Local)",
      "Ollama Cloud",
      "OpenRouter",
      "Custom",
      "ChatGPT OAuth",
      "Gemini OAuth",
    ]);
    expect(preset?.value).toBe("Custom");
    expect(page.querySelector("[data-llm-provider-model-chip]")).not.toBeNull();
    expect(Array.from(apiType?.options ?? []).map((option) => option.value)).toEqual([
      "OpenAI Compatible",
      "OpenAI Responses",
      "Anthropic API",
      "Gemini API",
    ]);
    expect(page.querySelector("[data-llm-provider-field=\"apiKey\"]")).not.toBeNull();
    expect(page.querySelector("[data-llm-provider-field=\"baseUrl\"]")).not.toBeNull();
    expect(page.querySelector("[data-llm-provider-field=\"noStainless\"]")).not.toBeNull();
    expect(Array.from(transport?.options ?? []).map((option) => option.value)).toEqual([
      "自动（推荐）",
      "仅浏览器 fetch",
      "仅 Obsidian requestUrl",
      "仅桌面端 Node fetch",
    ]);

    page.querySelector<HTMLButtonElement>("[data-llm-provider-header-add]")?.click();
    expect(page.querySelectorAll(".settings-provider-dialog__header-row input")).toHaveLength(2);

    page.querySelector<HTMLButtonElement>("[data-llm-provider-close]")?.click();
    expect(dialog?.hidden).toBe(true);
  });

  // fallow-ignore-next-line complexity
  it("infers NVIDIA provider settings from its base URL", async () => {
    const bodies: Array<{ url: string; body: unknown }> = [];
    vi.stubGlobal("fetch", makeNvidiaProviderFetch(bodies));

    const page = renderSettingsPage();
    document.body.appendChild(page);
    page.querySelector<HTMLButtonElement>("[data-llm-provider-add]")?.click();
    (page.querySelector("[data-llm-provider-field=\"id\"]") as HTMLInputElement).value = "main";
    (page.querySelector("[data-llm-provider-field=\"baseUrl\"]") as HTMLInputElement).value = "https://integrate.api.nvidia.com/v1";
    (page.querySelector("[data-llm-provider-field=\"apiKey\"]") as HTMLInputElement).value = "nvapi-key";
    page.querySelector<HTMLFormElement>("[data-llm-provider-form]")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await flush();
    await flush();

    expect(bodies).toContainEqual({
      url: "/api/llm/accounts",
      body: {
        name: "main",
        provider: "nvidia",
        url: "https://integrate.api.nvidia.com/v1",
        key: "nvapi-key",
        model: "meta/llama-3.3-70b-instruct",
        enabled: true,
      },
    });
  });

  function makeNvidiaProviderFetch(bodies: Array<{ url: string; body: unknown }>) {
    return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.body) bodies.push({ url, body: JSON.parse(String(init.body)) });
      const route = `${init?.method ?? "GET"} ${url}`;
      return nvidiaProviderResponses[route]?.() ?? jsonResponse({ success: true, data: { accounts: [] } });
    });
  }

  it("saves an API provider, keeps the old saved key, and tests connectivity", async () => {
    const bodies: Array<{ url: string; body: unknown }> = [];
    vi.stubGlobal(
      "fetch",
      // fallow-ignore-next-line complexity
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === "/api/llm/accounts" && !init?.method) {
          return jsonResponse({
            success: true,
            data: {
              accounts: [{
                id: "relay:-",
                name: "小马中转",
                provider: "relay",
                url: "https://xiaoma.best/v1",
                keyConfigured: true,
                model: "claude-sonnet-4-20250514",
                enabled: true,
                updatedAt: "2026-04-29T00:00:00.000Z",
              }],
            },
          });
        }
        if (init?.body) bodies.push({ url, body: JSON.parse(String(init.body)) });
        if (url === "/api/llm/accounts" && init?.method === "PUT") {
          return jsonResponse({
            success: true,
            data: {
              id: "relay:-",
              name: "小马中转",
              provider: "relay",
              url: "https://xiaoma.best/v1",
              keyConfigured: true,
              model: "claude-sonnet-4-20250514",
              enabled: true,
              updatedAt: "2026-04-29T00:00:00.000Z",
            },
          });
        }
        if (url === "/api/llm/config" && init?.method === "PUT") {
          return jsonResponse({ success: true, data: { accountRef: "api:relay:-", provider: "relay", url: "https://xiaoma.best/v1", keyConfigured: true, model: "claude-sonnet-4-20250514" } });
        }
        if (url === "/api/llm/test" && init?.method === "POST") {
          return jsonResponse({ success: true, data: { ok: true, provider: "relay", endpoint: "https://xiaoma.best/v1/chat/completions", message: "验证成功，API 可以连通。" } });
        }
        return jsonResponse({ success: true, data: {} });
      }),
    );

    const page = renderSettingsPage();
    document.body.appendChild(page);
    page.querySelector<HTMLButtonElement>("[data-llm-provider-add]")?.click();
    await flush();

    expect((page.querySelector("[data-llm-provider-field=\"id\"]") as HTMLInputElement).value).toBe("小马中转");
    expect((page.querySelector("[data-llm-provider-field=\"baseUrl\"]") as HTMLInputElement).value).toBe("https://xiaoma.best/v1");
    page.querySelector<HTMLFormElement>("[data-llm-provider-form]")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await flush();
    await flush();
    await flush();

    expect(bodies).toContainEqual({
      url: "/api/llm/accounts",
      body: {
        id: "relay:-",
        name: "小马中转",
        provider: "relay",
        url: "https://xiaoma.best/v1",
        key: "",
        model: "claude-sonnet-4-20250514",
        enabled: true,
      },
    });
    expect(bodies).toContainEqual({ url: "/api/llm/config", body: { accountRef: "api:relay:-" } });
    expect(bodies).toContainEqual({ url: "/api/llm/test", body: { accountRef: "api:relay:-" } });
    expect(page.querySelector("[data-llm-provider-status]")?.textContent).toContain("已保存并验证成功");
    expect(page.querySelector("[data-llm-provider-count]")?.textContent).toContain("已添加 1 个提供商");
    expect(page.querySelector("[data-llm-provider-card=\"api:relay:-\"]")).not.toBeNull();
    expect(page.querySelector("[data-llm-provider-card-id]")?.textContent).toBe("小马中转");
    expect(page.querySelector("[data-llm-provider-card=\"api:relay:-\"]")?.textContent).toContain("Custom");
    expect(page.querySelector("[data-llm-provider-card=\"api:relay:-\"]")?.textContent).toContain("未配置聊天模型");
  });

  it("starts OAuth when an OAuth provider is selected and verifies the account as usable", async () => {
    const bodies: Array<{ url: string; body: unknown }> = [];
    vi.stubGlobal("open", vi.fn());
    vi.stubGlobal(
      "fetch",
      // fallow-ignore-next-line complexity
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (init?.body) bodies.push({ url, body: JSON.parse(String(init.body)) });
        if (url === "/api/llm/accounts") return jsonResponse({ success: true, data: { accounts: [] } });
        if (url === "/api/account-ai/codex-oauth/start") {
          return jsonResponse({
            success: true,
            data: { url: "https://auth.example.com", state: "oauth-state", userCode: "ABCD-EFGH", pollIntervalSeconds: 5 },
          });
        }
        if (url === "/api/account-ai/codex-oauth/status?state=oauth-state") {
          return jsonResponse({ success: true, data: { status: "ok" } });
        }
        if (url === "/api/account-ai/codex-quota") {
          return jsonResponse({
            success: true,
            data: { accounts: [{ name: "cloud-account", provider: "codex", email: "me@example.com", enabled: true }] },
          });
        }
        if (url === "/api/cliproxy/accounts") {
          return jsonResponse({ success: true, data: { accounts: [] } });
        }
        if (url === "/api/llm/test" && init?.method === "POST") {
          return jsonResponse({
            success: true,
            data: {
              ok: true,
              provider: "codex-cli",
              endpoint: "http://127.0.0.1:8317/v1/chat/completions",
              message: "验证成功，API 可以连通。",
            },
          });
        }
        if (url === "/api/llm/config" && init?.method === "PUT") {
          return jsonResponse({ success: true, data: { accountRef: "oauth:codex:cloud-account", provider: "codex-cli", url: "http://127.0.0.1:8317/v1", keyConfigured: true, model: "gpt-5-codex" } });
        }
        return jsonResponse({ success: true, data: {} });
      }),
    );

    const page = renderSettingsPage();
    document.body.appendChild(page);
    page.querySelector<HTMLButtonElement>("[data-llm-provider-add]")?.click();
    (page.querySelector("[data-llm-provider-field=\"id\"]") as HTMLInputElement).value = "1";
    const preset = page.querySelector("[data-llm-provider-field=\"preset\"]") as HTMLSelectElement;
    preset.value = "ChatGPT OAuth";
    preset.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));
    await flush();
    await flush();
    await flush();
    await flush();

    expect((page.querySelector("[data-llm-provider-submit]") as HTMLButtonElement).textContent).toBe("授权并添加");
    expect(page.querySelector("[data-llm-provider-field=\"apiKey\"]")?.closest(".settings-provider-dialog__row")?.hasAttribute("hidden")).toBe(true);
    expect(page.querySelector("[data-llm-provider-field=\"baseUrl\"]")?.closest(".settings-provider-dialog__row")?.hasAttribute("hidden")).toBe(true);
    expect(page.querySelector("[data-llm-provider-oauth-code]")?.hasAttribute("hidden")).toBe(false);
    expect(page.querySelector("[data-llm-provider-oauth-user-code]")?.textContent).toBe("ABCD-EFGH");
    expect(page.querySelector<HTMLAnchorElement>("[data-llm-provider-oauth-link]")?.href).toBe("https://auth.example.com/");
    expect(window.open).toHaveBeenCalledWith("https://auth.example.com", "_blank", "noopener");
    expect(fetch).toHaveBeenCalledWith("/api/account-ai/codex-oauth/start", { method: "POST" });
    expect(bodies).toContainEqual({ url: "/api/llm/test", body: { accountRef: "oauth:codex:cloud-account" } });
    expect(bodies).toContainEqual({ url: "/api/llm/config", body: { accountRef: "oauth:codex:cloud-account" } });
    expect(page.querySelector("[data-llm-provider-status]")?.textContent).toContain("OAuth 已接入并验证可用");
    expect(page.querySelector("[data-llm-provider-card=\"oauth:codex:cloud-account\"]")).not.toBeNull();
    expect(page.querySelector("[data-llm-provider-card-id]")?.textContent).toBe("1");
    expect(page.querySelector("[data-llm-provider-card=\"oauth:codex:cloud-account\"]")?.textContent).toContain("ChatGPT OAuth");
  });

  it("keeps an OAuth provider after authorization when connectivity test fails", async () => {
    const bodies: Array<{ url: string; body: unknown }> = [];
    vi.stubGlobal("open", vi.fn());
    vi.stubGlobal(
      "fetch",
      // fallow-ignore-next-line complexity
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (init?.body) bodies.push({ url, body: JSON.parse(String(init.body)) });
        if (url === "/api/llm/accounts") return jsonResponse({ success: true, data: { accounts: [] } });
        if (url === "/api/account-ai/codex-oauth/start") {
          return jsonResponse({
            success: true,
            data: { url: "https://auth.example.com", state: "oauth-state", userCode: "ABCD-EFGH", pollIntervalSeconds: 5 },
          });
        }
        if (url === "/api/account-ai/codex-oauth/status?state=oauth-state") {
          return jsonResponse({ success: true, data: { status: "ok" } });
        }
        if (url === "/api/account-ai/codex-quota") {
          return jsonResponse({
            success: true,
            data: { accounts: [{ name: "cloud-account", provider: "codex", email: "me@example.com", enabled: true }] },
          });
        }
        if (url === "/api/cliproxy/accounts") return jsonResponse({ success: true, data: { accounts: [] } });
        if (url === "/api/llm/config" && init?.method === "PUT") {
          return jsonResponse({ success: true, data: { accountRef: "oauth:codex:cloud-account", provider: "codex-cli", url: "https://worker.example.com/user/ai", keyConfigured: true, model: "gpt-5.5" } });
        }
        if (url === "/api/llm/test" && init?.method === "POST") {
          return jsonResponse({ success: false, error: "Provider 连通测试失败：HTTP 502" }, 400);
        }
        return jsonResponse({ success: true, data: {} });
      }),
    );

    const page = renderSettingsPage();
    document.body.appendChild(page);
    page.querySelector<HTMLButtonElement>("[data-llm-provider-add]")?.click();
    (page.querySelector("[data-llm-provider-field=\"id\"]") as HTMLInputElement).value = "小马中转";
    const preset = page.querySelector("[data-llm-provider-field=\"preset\"]") as HTMLSelectElement;
    preset.value = "ChatGPT OAuth";
    preset.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));
    await flush();
    await flush();
    await flush();
    await flush();

    expect(bodies).toContainEqual({ url: "/api/llm/config", body: { accountRef: "oauth:codex:cloud-account" } });
    expect(bodies).toContainEqual({ url: "/api/llm/test", body: { accountRef: "oauth:codex:cloud-account" } });
    expect(page.querySelector("[data-llm-provider-status]")?.textContent).toContain("OAuth 已接入，但连通测试失败");
    expect(page.querySelector("[data-llm-provider-card=\"oauth:codex:cloud-account\"]")).not.toBeNull();
  });

  // fallow-ignore-next-line complexity
  it("uses provider chat models as app entries and wires provider card actions", async () => {
    const bodies: Array<{ url: string; body: unknown }> = [];
    let accounts = [{
      id: "relay:-",
      name: "小马中转",
      provider: "relay",
      url: "https://xiaoma.best/v1",
      keyConfigured: true,
      model: "claude-sonnet-4-20250514",
      enabled: true,
      updatedAt: "2026-04-29T00:00:00.000Z",
    }];
    vi.stubGlobal(
      "fetch",
      // fallow-ignore-next-line complexity
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (init?.body) bodies.push({ url, body: JSON.parse(String(init.body)) });
        if (url === "/api/llm/accounts" && !init?.method) {
          return jsonResponse({ success: true, data: { accounts } });
        }
        if (url === "/api/llm/accounts" && init?.method === "DELETE") {
          accounts = [];
          return jsonResponse({ success: true, data: null });
        }
        if (url === "/api/app-config" && !init?.method) {
          return jsonResponse({ success: true, data: { path: "agents/agents.json", defaultAppId: null, apps: [] } });
        }
        if (url === "/api/account-ai/codex-quota" || url === "/api/cliproxy/accounts") {
          return jsonResponse({ success: true, data: { accounts: [] } });
        }
        return jsonResponse({ success: true, data: {} });
      }),
    );

    const page = renderSettingsPage();
    document.body.appendChild(page);
    await flush();
    await flush();
    await flush();

    const card = page.querySelector<HTMLElement>("[data-llm-provider-card=\"api:relay:-\"]");
    expect(card).not.toBeNull();
    expect(card?.textContent).toContain("0 聊天模型");
    const collapse = card?.querySelector<HTMLButtonElement>("[data-llm-provider-card-collapse]");
    const body = card?.querySelector<HTMLElement>("[data-llm-provider-card-body]");
    expect(body?.hidden).toBe(true);
    expect(collapse?.getAttribute("aria-expanded")).toBe("false");

    card?.querySelector<HTMLButtonElement>("[data-llm-provider-card-configure]")?.click();
    expect(page.querySelector<HTMLElement>("[data-llm-provider-dialog]")?.hidden).toBe(false);
    expect((page.querySelector("[data-llm-provider-field=\"id\"]") as HTMLInputElement).value).toBe("小马中转");
    expect((page.querySelector("[data-llm-provider-field=\"baseUrl\"]") as HTMLInputElement).value).toBe("https://xiaoma.best/v1");
    page.querySelector<HTMLButtonElement>("[data-llm-provider-close]")?.click();

    collapse?.click();
    expect(body?.hidden).toBe(false);
    expect(collapse?.getAttribute("aria-expanded")).toBe("true");

    card?.querySelector<HTMLButtonElement>("[data-llm-provider-add-chat]")?.click();
    await flush();
    await flush();
    await flush();

    expect(page.querySelector<HTMLElement>("[data-agent-config-modal]")?.hidden).toBe(false);
    expect((page.querySelector("[data-agent-config-field=\"name\"]") as HTMLInputElement).value).toBe("小马中转 聊天");
    expect((page.querySelector("[data-agent-config-field=\"purpose\"]") as HTMLInputElement).value).toBe("聊天模型");
    expect((page.querySelector("[data-agent-config-field=\"provider\"]") as HTMLSelectElement).value).toBe("relay");
    expect((page.querySelector("[data-agent-config-field=\"accountRef\"]") as HTMLSelectElement).value).toBe("api:relay:-");
    expect((page.querySelector("[data-agent-config-field=\"model\"]") as HTMLSelectElement).value).toBe("claude-sonnet-4-20250514");
    expect(page.querySelector("[data-llm-provider-card=\"api:relay:-\"]")?.textContent).toContain("1 聊天模型");
    expect(page.querySelector("[data-llm-provider-card=\"api:relay:-\"]")?.textContent).toContain("小马中转 聊天");

    page.querySelector<HTMLButtonElement>("[data-llm-provider-chat-app]")?.click();
    expect(page.querySelector<HTMLElement>("[data-agent-config-modal]")?.hidden).toBe(false);

    page.querySelector<HTMLButtonElement>("[data-llm-provider-card-remove]")?.click();
    await flush();
    await flush();
    await flush();

    expect(bodies).toContainEqual({ url: "/api/llm/accounts", body: { id: "relay:-" } });
    expect(page.querySelector("[data-llm-provider-card=\"api:relay:-\"]")).toBeNull();
    expect(page.querySelector("[data-llm-provider-count]")?.textContent).toContain("已添加 0 个提供商");
  });

  it("deletes OAuth provider cards through the cliproxy account delete route", async () => {
    const bodies: Array<{ url: string; body: unknown }> = [];
    let accounts = [{ name: "gemini.json", provider: "gemini-cli", email: "gemini@example.com", enabled: true }];
    vi.stubGlobal(
      "fetch",
      // fallow-ignore-next-line complexity
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (init?.body) bodies.push({ url, body: JSON.parse(String(init.body)) });
        if (url === "/api/llm/accounts") return jsonResponse({ success: true, data: { accounts: [] } });
        if (url === "/api/app-config" && !init?.method) {
          return jsonResponse({ success: true, data: { path: "agents/agents.json", defaultAppId: null, apps: [] } });
        }
        if (url === "/api/account-ai/codex-quota") return jsonResponse({ success: true, data: { accounts: [] } });
        if (url === "/api/cliproxy/accounts" && !init?.method) {
          return jsonResponse({
            success: true,
            data: { accounts },
          });
        }
        if (url === "/api/cliproxy/accounts" && init?.method === "DELETE") {
          accounts = [];
          return jsonResponse({ success: true, data: { ok: true } });
        }
        return jsonResponse({ success: true, data: {} });
      }),
    );

    const page = renderSettingsPage();
    document.body.appendChild(page);
    await flush();
    await flush();
    await flush();

    const activeCard = page.querySelector<HTMLElement>("[data-llm-provider-card=\"oauth:gemini-cli:gemini.json\"]");
    expect(activeCard).not.toBeNull();
    activeCard?.querySelector<HTMLButtonElement>("[data-llm-provider-card-disconnect]")?.click();
    await flush();
    await flush();
    await flush();

    expect(bodies).toContainEqual({ url: "/api/cliproxy/accounts", body: { name: "gemini.json" } });
    expect(page.querySelector("[data-llm-provider-card=\"oauth:gemini-cli:gemini.json\"]")).toBeNull();
  });

  it("starts disabled OAuth provider cards through the cliproxy account switch", async () => {
    const bodies: Array<{ url: string; body: unknown }> = [];
    let enabled = false;
    vi.stubGlobal(
      "fetch",
      // fallow-ignore-next-line complexity
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (init?.body) bodies.push({ url, body: JSON.parse(String(init.body)) });
        if (url === "/api/llm/accounts") return jsonResponse({ success: true, data: { accounts: [] } });
        if (url === "/api/app-config" && !init?.method) {
          return jsonResponse({ success: true, data: { path: "agents/agents.json", defaultAppId: null, apps: [] } });
        }
        if (url === "/api/account-ai/codex-quota") return jsonResponse({ success: true, data: { accounts: [] } });
        if (url === "/api/cliproxy/accounts") {
          return jsonResponse({
            success: true,
            data: { accounts: [{ name: "gemini.json", provider: "gemini-cli", email: "gemini@example.com", enabled }] },
          });
        }
        if (url === "/api/cliproxy/accounts/enabled" && init?.method === "POST") {
          enabled = (JSON.parse(String(init.body)) as { enabled: boolean }).enabled;
          return jsonResponse({ success: true, data: { ok: true } });
        }
        if (url === "/api/llm/config" && init?.method === "PUT") {
          return jsonResponse({ success: true, data: {} });
        }
        return jsonResponse({ success: true, data: {} });
      }),
    );

    const page = renderSettingsPage();
    document.body.appendChild(page);
    await flush();
    await flush();
    await flush();

    const disabledCard = page.querySelector<HTMLElement>("[data-llm-provider-card=\"oauth:gemini-cli:gemini.json\"]");
    expect(disabledCard?.textContent).toContain("已停用");
    disabledCard?.querySelector<HTMLButtonElement>("[data-llm-provider-card-start]")?.click();
    await flush();
    await flush();
    await flush();

    expect(bodies).toContainEqual({ url: "/api/cliproxy/accounts/enabled", body: { name: "gemini.json", enabled: true } });
    expect(bodies).toContainEqual({ url: "/api/llm/config", body: { accountRef: "oauth:gemini-cli:gemini.json" } });
    expect(page.querySelector("[data-llm-provider-card=\"oauth:gemini-cli:gemini.json\"]")?.textContent).not.toContain("已停用");
  });

  // fallow-ignore-next-line complexity
  it("starts disabled API provider cards from the provider list", async () => {
    const bodies: Array<{ url: string; body: unknown }> = [];
    let enabled = false;
    vi.stubGlobal(
      "fetch",
      // fallow-ignore-next-line complexity
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (init?.body) bodies.push({ url, body: JSON.parse(String(init.body)) });
        if (url === "/api/llm/accounts" && !init?.method) {
          return jsonResponse({
            success: true,
            data: {
              accounts: [{
                id: "relay:-",
                name: "小马中转",
                provider: "relay",
                url: "https://xiaoma.best/v1",
                keyConfigured: true,
                model: "claude-sonnet-4-20250514",
                enabled,
                updatedAt: "2026-04-29T00:00:00.000Z",
              }],
            },
          });
        }
        if (url === "/api/llm/accounts/start" && init?.method === "POST") {
          enabled = true;
          return jsonResponse({ success: true, data: {} });
        }
        if (url === "/api/account-ai/codex-quota" || url === "/api/cliproxy/accounts") {
          return jsonResponse({ success: true, data: { accounts: [] } });
        }
        return jsonResponse({ success: true, data: {} });
      }),
    );

    const page = renderSettingsPage();
    document.body.appendChild(page);
    await flush();
    await flush();

    const card = page.querySelector<HTMLElement>("[data-llm-provider-card=\"api:relay:-\"]");
    expect(card?.textContent).toContain("已停用");
    expect(card?.textContent).toContain("启动");
    card?.querySelector<HTMLButtonElement>("[data-llm-provider-card-start]")?.click();
    await flush();
    await flush();
    await flush();

    expect(bodies).toContainEqual({
      url: "/api/llm/accounts/start",
      body: { id: "relay:-" },
    });
    expect(page.querySelector("[data-llm-provider-card=\"api:relay:-\"]")?.textContent).not.toContain("已停用");
  });

  it("renders Cloudflare Workers AI as a provider with available embedding models", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === "/api/llm/accounts") return jsonResponse({ success: true, data: { accounts: [] } });
        if (url === "/api/account-ai/codex-quota" || url === "/api/cliproxy/accounts") {
          return jsonResponse({ success: true, data: { accounts: [] } });
        }
        if (url === "/api/llm/cloudflare-provider") {
          return jsonResponse({
            success: true,
            data: {
              accountRef: "cloudflare:workers-ai",
              configured: true,
              runtime: "worker",
              endpoint: "https://worker.example.com/",
              aiModel: "@cf/meta/llama-3.1-8b-instruct",
              embeddingModels: ["@cf/baai/bge-base-en-v1.5"],
            },
          });
        }
        return jsonResponse({ success: true, data: {} });
      }),
    );

    const page = renderSettingsPage();
    document.body.appendChild(page);
    await flush();
    await flush();

    const card = page.querySelector("[data-llm-provider-card=\"cloudflare:workers-ai\"]");
    expect(card).not.toBeNull();
    expect(card?.textContent).toContain("Cloudflare Workers AI");
    expect(card?.textContent).toContain("1 嵌入模型");
    expect(card?.textContent).toContain("@cf/baai/bge-base-en-v1.5");
    expect(card?.textContent).toContain("可用");
  });

  it("renders repository, llm, and search sections without the retired vector search page", () => {
    const page = renderSettingsPage();

    expect(page.querySelector(".settings-page__title")?.textContent).toContain("\u8bbe\u7f6e");
    expect(page.textContent).toContain("\u4ed3\u5e93\u4e0e\u540c\u6b65");
    expect(page.textContent).toContain("\u6570\u636e\u5bfc\u5165");
    expect(page.textContent).toContain("\u5c0f\u7ea2\u4e66");
    expect(page.textContent).toContain("闪念笔记");
    expect(page.textContent).toContain("X (Twitter)");
    expect(page.textContent).toContain("2. \u540c\u6b65\u4ed3\u5e93");
    expect(page.textContent).toContain("LLM");
    expect(page.textContent).toContain("\u7f51\u7edc\u641c\u7d22");
    expect(page.textContent).toContain("Embedding 来源");
    expect(page.textContent).toContain("可选 embedding 服务");
    expect(page.querySelector("[data-embedding-services-list]")).not.toBeNull();
    expect(page.textContent).not.toContain("Vector Search / Embedding");
    expect(page.querySelector("[data-settings-nav=\"embedding\"]")).toBeNull();
    expect(page.querySelector("[data-settings-panel=\"embedding\"]")).toBeNull();
    expect(page.textContent).toContain("\u9879\u76ee\u65e5\u5fd7");
    expect(page.textContent).toContain("\u5feb\u6377\u952e");
    expect(page.textContent).toContain("\u95ea\u5ff5\u65e5\u8bb0\u5feb\u901f\u8bb0\u5f55");
    expect(page.textContent).toContain("\u9875\u9762\u5185\u67e5\u627e");
    expect(page.textContent).toContain("\u6267\u884c\u8bb0\u5f55\u5668");
    expect(page.textContent).toContain("\u5de5\u4f5c\u53f0\u4fdd\u5b58");
    expect(page.querySelector("[data-search-provider-status]")).not.toBeNull();
    expect((page.querySelector("[data-shortcut-id=\"flashDiaryCapture\"]") as HTMLInputElement).value).toBe("CommandOrControl+Shift+J");
    expect((page.querySelector("[data-shortcut-id=\"pageTextSearch\"]") as HTMLInputElement).value).toBe("Ctrl+F");
    expect((page.querySelector("[data-shortcut-id=\"workflowRecorder\"]") as HTMLInputElement).value).toBe("CommandOrControl+Shift+E");
    expect((page.querySelector("[data-shortcut-id=\"workspaceSave\"]") as HTMLInputElement).value).toBe("CommandOrControl+S");
    expect(page.querySelector("[data-settings-panel=\"shortcuts\"] .settings-page__header")).toBeNull();
    expect(page.querySelector("[data-settings-nav=\"user-guide\"]")?.textContent).toContain("使用说明");
    expect(page.querySelector("[data-settings-nav=\"project-log\"]")?.textContent).toContain("项目日志");
    expect(page.querySelector("[data-settings-nav=\"plugins\"]")?.textContent).toContain("插件");
    expect(page.querySelector("[data-settings-nav=\"plugins\"]")?.textContent).not.toContain("MCP");
  });

  it("captures shortcut key presses in the shortcuts settings inputs", () => {
    const page = renderSettingsPage();
    const shortcutInput = page.querySelector<HTMLInputElement>("[data-shortcut-id=\"pageTextSearch\"]");

    shortcutInput?.dispatchEvent(new KeyboardEvent("keydown", {
      key: "g",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    }));

    expect(shortcutInput?.value).toBe("Ctrl+G");
    expect(page.querySelector("[data-shortcut-status]")?.textContent).toContain("\u5df2\u6355\u83b7\u5feb\u6377\u952e");
  });

  it("saves page shortcuts without showing desktop global registration failures", async () => {
    const saveShortcut = vi.fn(async () => ({
      shortcuts: {
        flashDiaryCapture: "CommandOrControl+Shift+J",
        pageTextSearch: "Ctrl+G",
        workflowRecorder: "CommandOrControl+Shift+E",
        workspaceSave: "CommandOrControl+S",
      },
      registered: false,
      error: "Shortcut registration failed",
    }));
    (window as Window & { llmWikiDesktop?: unknown }).llmWikiDesktop = { saveShortcut };
    const page = renderSettingsPage();
    const shortcutInput = page.querySelector<HTMLInputElement>("[data-shortcut-id=\"pageTextSearch\"]");

    shortcutInput?.dispatchEvent(new KeyboardEvent("keydown", {
      key: "g",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    }));
    page.querySelector<HTMLButtonElement>("[data-shortcut-save=\"pageTextSearch\"]")?.click();
    await flush();

    expect(saveShortcut).toHaveBeenCalledWith({ id: "pageTextSearch", accelerator: "Ctrl+G" });
    expect(page.querySelector("[data-shortcut-status]")?.textContent).toContain("\u5df2\u4fdd\u5b58\u5e76\u751f\u6548");
    expect(page.querySelector("[data-shortcut-status]")?.textContent).not.toContain("\u6ce8\u518c\u5931\u8d25");
  });

  it("opens app editing in a modal and restores unsaved edits on cancel", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === "/api/search/status") {
          return {
            ok: true,
            json: async () => ({ success: true, data: { local: { configured: true }, web: { configured: false, endpointHost: null } } }),
          } as Response;
        }
        if (url === "/api/llm/config") {
          return {
            ok: true,
            json: async () => ({ success: true, data: { provider: "openai", url: "", keyConfigured: false, model: "gpt-5-codex" } }),
          } as Response;
        }
        if (url === "/api/llm/accounts") {
          return {
            ok: true,
            json: async () => ({ success: true, data: { accounts: [] } }),
          } as Response;
        }
        if (url === "/api/cliproxy/accounts") {
          return {
            ok: true,
            json: async () => ({ success: true, data: { accounts: [] } }),
          } as Response;
        }
        if (url === "/api/app-config") {
          return {
            ok: true,
            json: async () => ({
              success: true,
              data: {
                path: "agents/agents.json",
                defaultAppId: "wiki-general",
                apps: [{
                  id: "wiki-general",
                  name: "Wiki General",
                  mode: "chat",
                  purpose: "General wiki work",
                  provider: "openai",
                  accountRef: "",
                  model: "",
                  workflow: "Read context",
                  prompt: "Stay grounded.",
                  enabled: true,
                  updatedAt: "2026-04-29T00:00:00.000Z",
                }],
              },
            }),
          } as Response;
        }
        throw new Error(`unexpected fetch ${url}`);
      }),
    );

    const page = renderSettingsPage();
    document.body.appendChild(page);
    await flush();
    page.querySelector<HTMLButtonElement>("[data-settings-nav=\"app-config\"]")?.click();
    await flush();

    const modal = page.querySelector<HTMLElement>("[data-agent-config-modal]");
    expect(modal?.hidden).toBe(true);
    page.querySelector<HTMLButtonElement>("[data-agent-config-select=\"wiki-general\"]")?.click();
    expect(modal?.hidden).toBe(false);

    const nameInput = page.querySelector<HTMLInputElement>("[data-agent-config-field=\"name\"]");
    if (!nameInput) throw new Error("Agent name input missing");
    nameInput.value = "Changed Name";
    nameInput.dispatchEvent(new Event("input", { bubbles: true }));
    page.querySelector<HTMLButtonElement>("[data-agent-config-close]")?.click();

    expect(modal?.hidden).toBe(true);
    page.querySelector<HTMLButtonElement>("[data-agent-config-select=\"wiki-general\"]")?.click();
    expect((page.querySelector("[data-agent-config-field=\"name\"]") as HTMLInputElement).value).toBe("Wiki General");
  });

  it("keeps import source cards visible and marks them unavailable on click", () => {
    const page = renderSettingsPage();
    document.body.appendChild(page);

    const rssPage = page.querySelector<HTMLElement>("[data-rss-import-page]");
    const flashNotePage = page.querySelector<HTMLElement>("[data-flash-note-import-page]");
    const homeSections = Array.from(page.querySelectorAll<HTMLElement>("[data-import-home]"));
    expect(rssPage?.hidden).toBe(true);
    expect(flashNotePage?.hidden).toBe(true);
    expect(homeSections.every((section) => section.hidden === false)).toBe(true);

    [
      ["xiaohongshu", "小红书"],
      ["wechat", "微信聊天记录"],
      ["flash-note", "闪念笔记"],
      ["douyin", "抖音"],
      ["bilibili", "b站"],
      ["xiaoyuzhou", "小宇宙"],
      ["rss", "RSS"],
      ["x", "X (Twitter)"],
    ].forEach(([sourceId, sourceName]) => {
      page.querySelector<HTMLButtonElement>(`[data-import-source="${sourceId}"]`)?.click();
      expect(page.querySelector("[data-settings-status]")?.textContent).toContain(
        `${sourceName}：之后将支持，现在暂不开放。`,
      );
      expect(rssPage?.hidden).toBe(true);
      expect(flashNotePage?.hidden).toBe(true);
      expect(homeSections.every((section) => section.hidden === false)).toBe(true);
    });

    expect(window.location.hash).not.toBe("#/flash-diary");
  });

  it("defines the settings content as the scroll container inside the full-page shell", () => {
    const stylesheet = readFileSync(
      path.resolve(import.meta.dirname, "../web/client/styles.css"),
      "utf8",
    );

    expect(stylesheet).toContain("#workspace-shell[data-full-page] .shell-main");
    expect(stylesheet).toContain("overflow: hidden;");
    expect(stylesheet).toMatch(/\.settings-page\s*\{[^}]*\n\s*height:\s*100%;/);
    expect(stylesheet).toMatch(/\.settings-page\s*\{[^}]*\n\s*min-height:\s*0;/);
    expect(stylesheet).toMatch(/\.settings-content\s*\{[^}]*\n\s*height:\s*100%;/);
    expect(stylesheet).toMatch(/\.settings-content\s*\{[^}]*\n\s*min-height:\s*0;/);
    expect(stylesheet).toMatch(/\.settings-content\s*\{[^}]*\n\s*overflow-y:\s*auto;/);
  });

  it("renders a resizable settings navigation and shows web search under LLM providers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === "/api/search/status") {
          return {
            ok: true,
            json: async () => ({
              success: true,
              data: {
                local: { configured: true },
                web: { configured: true, endpointHost: "search.example.com" },
              },
            }),
          } as Response;
        }
        if (url === "/api/search/test") {
          return {
            ok: true,
            json: async () => ({
              success: true,
              data: { ok: true, message: "connected" },
            }),
          } as Response;
        }
        throw new Error(`unexpected fetch ${url}`);
      }),
    );

    const page = renderSettingsPage();
    document.body.appendChild(page);
    await flush();

    expect(page.querySelector("[data-settings-sidebar]")).not.toBeNull();
    expect(page.querySelector("[data-settings-sidebar-resize]")).not.toBeNull();
    expect(page.querySelector("[data-settings-section=\"app-config\"]")).not.toBeNull();
    const navItems = Array.from(page.querySelectorAll("[data-settings-nav]"));
    expect(navItems[1]?.getAttribute("data-settings-nav")).toBe("app-config");
    expect(navItems[2]?.getAttribute("data-settings-nav")).toBe("automation");
    expect(page.querySelector("[data-settings-section=\"llm\"]")?.textContent).toContain("LLM");
    expect(page.querySelector("[data-settings-section=\"network-search\"]")).toBeNull();
    expect(page.querySelector("[data-settings-section=\"embedding\"]")).toBeNull();
    expect(page.querySelector("[data-settings-section=\"plugins\"]")?.textContent).toContain("插件");
    expect(page.querySelector("[data-settings-section=\"plugins\"]")?.textContent).not.toContain("MCP");
    expect(page.querySelector("[data-settings-section=\"workspace-sync\"]")?.textContent).toContain("同步");

    const llmPanel = page.querySelector<HTMLElement>("[data-settings-panel=\"llm\"]");
    expect(llmPanel?.textContent).toContain("网络搜索 API");
    expect(page.querySelector("[data-search-provider-status]")?.textContent).toContain("search.example.com");
    expect(page.querySelector("[data-search-provider-light]")?.className).toContain("is-ok");
    expect(page.textContent).not.toContain("外网搜索状态");

    page.querySelector<HTMLButtonElement>("[data-search-provider-test]")?.click();
    await flush();
    expect(fetch).toHaveBeenCalledWith("/api/search/test", { method: "POST" });
    expect(page.querySelector("[data-search-provider-status]")?.textContent).toContain("connected");
  });

  it("keeps the third-party plugin entry as a future support placeholder", () => {
    const page = renderSettingsPage("plugins");
    document.body.appendChild(page);

    const panel = queryRequired<HTMLElement>(page, "[data-settings-panel=\"plugins\"]");
    const nav = queryRequired<HTMLElement>(page, "[data-settings-plugin-kind=\"third-party\"]:not([data-settings-plugin-id])");
    expect(panel.hidden).toBe(false);
    expect(nav.textContent?.trim()).toBe("第三方插件");
    expect(nav.getAttribute("data-active")).toBe("true");
    expect(panel.textContent).toContain("第三方插件入口已保留");
    expect(panel.textContent).toContain("后续版本将支持社区插件安装、更新和管理");
    expect(panel.querySelector(".settings-plugins__header")).toBeNull();
    expect(page.querySelector("[data-settings-plugin-id]")).toBeNull();
    expect(panel.textContent).not.toContain("LLM Wiki Audit");
    expect(panel.textContent).not.toContain("SMART CLI");
    expect(panel.textContent).not.toContain("Claudian");
    expect(panel.textContent).not.toContain("YOLO");
  });

  it("opens settings in a dialog from the rail defaulting to the third-party plugin settings page", () => {
    const closed = vi.fn();
    const dialog = openSettingsDialog({ onClose: closed });

    expect(dialog.getAttribute("data-settings-dialog")).toBe("true");
    expect(document.body.contains(dialog)).toBe(true);
    expect(dialog.querySelector(".settings-dialog__panel")).not.toBeNull();
    expect(dialog.querySelector(".settings-page--dialog")).not.toBeNull();
    expect(dialog.querySelector("[data-settings-sidebar]")).not.toBeNull();
    expect(dialog.querySelector("[data-settings-nav=\"llm\"]")).not.toBeNull();
    expect(dialog.querySelector("[data-settings-nav=\"automation\"]")).not.toBeNull();
    expect(dialog.querySelector("[data-settings-plugin-kind=\"third-party\"]:not([data-settings-plugin-id])")?.getAttribute("data-active")).toBe("true");
    const dialogStyles = readFileSync(
      path.resolve(import.meta.dirname, "../web/client/assets/styles/settings-dialog.css"),
      "utf8",
    );
    expect(dialogStyles).toMatch(/\.settings-dialog\s*\{[\s\S]*background:\s*#eef2f7;/i);
    const panel = queryRequired<HTMLElement>(dialog, "[data-settings-panel=\"plugins\"]");
    expect(panel.textContent).toContain("第三方插件入口已保留");
    expect(dialog.querySelector("[data-settings-plugin-id]")).toBeNull();
    expect(panel.textContent).not.toContain("LLM Wiki Audit");
    expect(panel.textContent).not.toContain("SMART CLI");
    expect(panel.textContent).not.toContain("Claudian");

    queryRequired<HTMLButtonElement>(dialog, "[data-settings-dialog-close]").click();
    expect(document.body.contains(dialog)).toBe(false);
    expect(closed).toHaveBeenCalledOnce();
  });

  it("loads and saves the network search provider config", async () => {
    let savedBody: unknown = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === "/api/search/status") {
          return {
            ok: true,
            json: async () => ({
              success: true,
              data: {
                local: { configured: true },
                web: { configured: true, endpointHost: "search.example.com" },
              },
            }),
          } as Response;
        }
        if (url === "/api/search/config" && !init?.method) {
          return {
            ok: true,
            json: async () => ({
              success: true,
              data: {
                url: "https://search.example.com/query/",
                keyConfigured: true,
                model: "provider/model",
              },
            }),
          } as Response;
        }
        if (url === "/api/search/config" && init?.method === "PUT") {
          savedBody = JSON.parse(String(init.body));
          return {
            ok: true,
            json: async () => ({
              success: true,
              data: {
                url: "https://search.example.com/live",
                keyConfigured: true,
                model: "provider/live-model",
              },
            }),
          } as Response;
        }
        throw new Error(`unexpected fetch ${url}`);
      }),
    );

    const page = renderSettingsPage();
    document.body.appendChild(page);
    await flush();
    await flush();

    expect((page.querySelector("[data-provider=\"search:url\"]") as HTMLInputElement).value).toBe("https://search.example.com/query/");
    expect((page.querySelector("[data-provider=\"search:model\"]") as HTMLInputElement).value).toBe("provider/model");

    (page.querySelector("[data-provider=\"search:url\"]") as HTMLInputElement).value = "https://search.example.com/live";
    (page.querySelector("[data-provider=\"search:key\"]") as HTMLInputElement).value = "search-secret";
    (page.querySelector("[data-provider=\"search:model\"]") as HTMLInputElement).value = "provider/live-model";

    page.querySelector<HTMLButtonElement>("[data-search-provider-save]")?.click();
    await flush();

    expect(fetch).toHaveBeenCalledWith(
      "/api/search/config",
      expect.objectContaining({
        method: "PUT",
        headers: { "Content-Type": "application/json" },
      }),
    );
    expect(savedBody).toEqual({
      url: "https://search.example.com/live",
      key: "search-secret",
      model: "provider/live-model",
    });
    expect(page.querySelector("[data-search-provider-status]")?.textContent).toContain("保存");
  });

  it("loads and saves agent configuration from the settings page", async () => {
    let savedBody: unknown = null;
    vi.stubGlobal(
      "fetch",
      // fallow-ignore-next-line complexity
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === "/api/search/status") {
          return {
            ok: true,
            json: async () => ({
              success: true,
              data: {
                local: { configured: true },
                web: { configured: false, endpointHost: null },
              },
            }),
          } as Response;
        }
        if (url === "/api/llm/config" && !init?.method) {
          return {
            ok: true,
            json: async () => ({ success: true, data: { provider: "openai", url: "", keyConfigured: false, model: "gpt-5-codex" } }),
          } as Response;
        }
        if (url === "/api/llm/accounts") {
          return {
            ok: true,
            json: async () => ({ success: true, data: { accounts: [] } }),
          } as Response;
        }
        if (url === "/api/cliproxy/accounts") {
          return {
            ok: true,
            json: async () => ({
              success: true,
              data: {
                accounts: [
                  {
                    name: "gemini.json",
                    provider: "gemini-cli",
                    email: "gemini@example.com",
                    enabled: true,
                  },
                ],
              },
            }),
          } as Response;
        }
        if (url === "/api/cliproxy/accounts/models?name=gemini.json") {
          return {
            ok: true,
            json: async () => ({
              success: true,
              data: {
                models: [{ id: "gemini-2.5-pro" }, { id: "gemini-2.5-flash" }],
              },
            }),
          } as Response;
        }
        if (url === "/api/app-config" && !init?.method) {
          return {
            ok: true,
            json: async () => ({
              success: true,
              data: {
                path: "agents/agents.json",
                defaultAppId: "writer",
                apps: [{
                  id: "writer",
                  name: "鍐欎綔 Agent",
                  purpose: "draft notes",
                  provider: "openai",
                  accountRef: "",
                  model: "gpt-5-codex",
                  workflow: "璇诲彇璧勬枡\n鐢熸垚鑽夌",
                  prompt: "淇濇寔缁撴瀯娓呮櫚",
                  enabled: true,
                  updatedAt: "2026-04-23T00:00:00.000Z",
                }],
              },
            }),
          } as Response;
        }
        if (url === "/api/app-config" && init?.method === "PUT") {
          savedBody = JSON.parse(String(init.body));
          return {
            ok: true,
            json: async () => ({ success: true, data: { ...(savedBody as object), path: "agents/agents.json" } }),
          } as Response;
        }
        throw new Error(`unexpected fetch ${url}`);
      }),
    );

    const page = renderSettingsPage();
    document.body.appendChild(page);
    await flush();

    page.querySelector<HTMLButtonElement>("[data-settings-nav=\"app-config\"]")?.click();
    await flush();
    expect(page.querySelector("[data-settings-panel=\"app-config\"]")?.hasAttribute("hidden")).toBe(false);
    expect(page.querySelector("[data-agent-config-list]")?.textContent).toContain("鍐欎綔 Agent");
    expect((page.querySelector("[data-agent-config-field=\"model\"]") as HTMLSelectElement).value).toBe("gpt-5-codex");

    (page.querySelector("[data-agent-config-field=\"purpose\"]") as HTMLInputElement).value = "draft long article";
    page.querySelector<HTMLInputElement>("[data-agent-config-field=\"purpose\"]")?.dispatchEvent(new Event("input", { bubbles: true }));
    (page.querySelector("[data-agent-config-field=\"provider\"]") as HTMLSelectElement).value = "gemini";
    page.querySelector<HTMLSelectElement>("[data-agent-config-field=\"provider\"]")?.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();
    const accountSelect = page.querySelector<HTMLSelectElement>("[data-agent-config-field=\"accountRef\"]");
    if (!accountSelect) throw new Error("Agent account select missing");
    expect(accountSelect.textContent).toContain("gemini@example.com");
    accountSelect.value = "oauth:gemini-cli:gemini.json";
    accountSelect.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();
    (page.querySelector("[data-agent-config-field=\"model\"]") as HTMLSelectElement).value = "gemini-2.5-pro";
    (page.querySelector("[data-agent-config-field=\"workflow\"]") as HTMLTextAreaElement).value = "understand task`nread context`ngenerate draft";
    page.querySelector<HTMLTextAreaElement>("[data-agent-config-field=\"workflow\"]")?.dispatchEvent(new Event("input", { bubbles: true }));
    (page.querySelector("[data-agent-config-field=\"prompt\"]") as HTMLTextAreaElement).value = "keep structure clear and explain verification";
    page.querySelector<HTMLTextAreaElement>("[data-agent-config-field=\"prompt\"]")?.dispatchEvent(new Event("input", { bubbles: true }));
    page.querySelector<HTMLButtonElement>("[data-agent-config-save]")?.click();
    await flush();

    expect(fetch).toHaveBeenCalledWith(
      "/api/app-config",
      expect.objectContaining({
        method: "PUT",
        headers: { "Content-Type": "application/json" },
      }),
    );
    expect(savedBody).toMatchObject({
      defaultAppId: "writer",
      apps: [
        expect.objectContaining({
          id: "writer",
          purpose: "draft long article",
          provider: "gemini",
          accountRef: "oauth:gemini-cli:gemini.json",
          model: "gemini-2.5-pro",
          workflow: "understand task`nread context`ngenerate draft",
          prompt: "keep structure clear and explain verification",
        }),
      ],
    });
    expect((page.querySelector("[data-agent-config-field=\"provider\"]") as HTMLSelectElement).value).toBe("gemini");
    expect((page.querySelector("[data-agent-config-field=\"accountRef\"]") as HTMLSelectElement).value).toBe("oauth:gemini-cli:gemini.json");
    expect((page.querySelector("[data-agent-config-field=\"model\"]") as HTMLSelectElement).value).toBe("gemini-2.5-pro");
    expect((page.querySelector("[data-agent-config-field=\"workflow\"]") as HTMLTextAreaElement).value).toBe("understand task`nread context`ngenerate draft");
    expect((page.querySelector("[data-agent-config-field=\"prompt\"]") as HTMLTextAreaElement).value).toBe("keep structure clear and explain verification");
    expect(page.querySelector("[data-agent-config-status]")?.textContent).toContain("agents/agents.json");
  });

  it("reuses the workflow workspace inside the settings automation section", async () => {
    vi.stubGlobal("EventSource", createSilentEventSourceStub());
    vi.stubGlobal(
      "fetch",
      // fallow-ignore-next-line complexity
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === "/api/search/status") {
          return {
            ok: true,
            json: async () => ({
              success: true,
              data: {
                local: { configured: true },
                web: { configured: false, endpointHost: null },
              },
            }),
          } as Response;
        }
        if (url === "/api/llm/config" && !init?.method) {
          return {
            ok: true,
            json: async () => ({ success: true, data: { provider: "openai", url: "", keyConfigured: false, model: "gpt-5-codex" } }),
          } as Response;
        }
        if (url === "/api/llm/accounts") {
          return {
            ok: true,
            json: async () => ({ success: true, data: { accounts: [] } }),
          } as Response;
        }
        if (url === "/api/cliproxy/accounts") {
          return {
            ok: true,
            json: async () => ({ success: true, data: { accounts: [] } }),
          } as Response;
        }
        if (url === "/api/app-config" && !init?.method) {
          return {
            ok: true,
            json: async () => ({
              success: true,
              data: {
                path: "agents/agents.json",
                defaultAppId: "writer",
                apps: [{
                  id: "writer",
                  name: "Writer App",
                  mode: "chat",
                  purpose: "draft articles",
                  provider: "openai",
                  accountRef: "",
                  model: "gpt-5-codex",
                  workflow: "",
                  prompt: "",
                  enabled: true,
                  updatedAt: "2026-04-25T00:00:00.000Z",
                }],
              },
            }),
          } as Response;
        }
        if (url === "/api/automation-workspace/daily-sync") {
          return jsonResponse({
            success: true,
            data: {
              automation: {
                id: "daily-sync",
                name: "Daily Workflow",
                summary: "Sync yesterday content.",
                icon: "calendar",
                enabled: true,
                trigger: "schedule",
                sourceKind: "automation",
                viewMode: "flow",
                flow: {
                  nodes: [{
                    id: "trigger",
                    type: "trigger",
                    title: "Start",
                    description: "Start workflow.",
                    effectiveModel: { provider: "", model: "", source: "none", label: "" },
                  }],
                  edges: [],
                  branches: [],
                },
              },
              comments: [],
              layout: { automationId: "daily-sync", branchOffsets: {} },
            },
          });
        }
        if (url === "/api/automation-workspace/daily-sync/logs") {
          return jsonResponse({ success: true, data: { logs: [] } });
        }
        if (url === "/api/automation-workspace") {
          return new Response(
            JSON.stringify({
              success: true,
              data: {
                automations: [{
                  id: "daily-sync",
                  name: "Daily Workflow",
                  summary: "Sync yesterday content.",
                  icon: "calendar",
                  enabled: true,
                  trigger: "schedule",
                  sourceKind: "automation",
                }],
              },
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          );
        }
        throw new Error(`unexpected fetch ${url}`);
      }),
    );

    const page = renderSettingsPage();
    document.body.appendChild(page);
    await flush();

    page.querySelector<HTMLButtonElement>("[data-settings-nav=\"automation\"]")?.click();
    await flush();
    await flush();

    expect(page.querySelector("[data-settings-panel=\"automation\"]")?.hasAttribute("hidden")).toBe(false);
    expect(page.querySelector(".automation-page")).not.toBeNull();
    expect(page.querySelector("[data-automation-config-field=\"id\"]")).toBeNull();
    expect(page.querySelector("[data-automation-filter]")).toBeNull();
    expect(page.textContent).toContain("Workflow");
    expect(page.textContent).not.toContain("全部 Workflow");
    expect(page.textContent).toContain("Daily Workflow");

    page.querySelector<HTMLButtonElement>("[data-automation-log=\"daily-sync\"]")?.click();
    await flush();
    expect(window.location.hash).toBe("");
    expect(page.querySelector(".automation-log-page")).not.toBeNull();

    page.querySelector<HTMLButtonElement>("[data-automation-log-back]")?.click();
    await flush();
    expect(page.querySelector(".automation-page")).not.toBeNull();

    page.querySelector<HTMLButtonElement>("[data-automation-open=\"daily-sync\"]")?.click();
    await flush();
    expect(window.location.hash).toBe("");
    expect(page.querySelector(".automation-detail__header")).not.toBeNull();
  });

  it("renders the project log page inside the settings project-log section", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === "/api/search/status") {
          return {
            ok: true,
            json: async () => ({
              success: true,
              data: {
                local: { configured: true },
                web: { configured: false, endpointHost: null },
              },
            }),
          } as Response;
        }
        if (url === "/api/llm/config") {
          return {
            ok: true,
            json: async () => ({ success: true, data: { provider: "openai", url: "", keyConfigured: false, model: "gpt-5-codex" } }),
          } as Response;
        }
        if (url === "/api/llm/accounts" || url === "/api/cliproxy/accounts") {
          return {
            ok: true,
            json: async () => ({ success: true, data: { accounts: [] } }),
          } as Response;
        }
        if (url === "/api/cliproxy/status") {
          return {
            ok: true,
            json: async () => ({ success: true, data: { running: false, proxyBaseUrl: "http://127.0.0.1:8317/v1", accounts: [] } }),
          } as Response;
        }
        if (url === "/api/app-config") {
          return {
            ok: true,
            json: async () => ({ success: true, data: { apps: [], defaultAppId: null, path: "agents/agents.json" } }),
          } as Response;
        }
        if (url === "/api/project-log") {
          return {
            ok: true,
            json: async () => ({
              success: true,
              data: {
                path: "docs/project-log.md",
                html: "<h1>Project Log</h1><h2>Current Interface</h2>",
                raw: "# Project Log",
                modifiedAt: "2026-04-28T10:00:00.000Z",
              },
            }),
          } as Response;
        }
        throw new Error(`unexpected fetch ${url}`);
      }),
    );

    const page = renderSettingsPage();
    document.body.appendChild(page);
    await flush();

    page.querySelector<HTMLButtonElement>("[data-settings-nav=\"project-log\"]")?.click();
    await flush();

    expect(page.querySelector("[data-settings-panel=\"project-log\"]")?.hasAttribute("hidden")).toBe(false);
    expect(page.querySelector('[data-settings-nav="project-log"]')?.getAttribute("data-active")).toBe("true");
    expect(page.querySelector(".project-log-page__title")?.textContent).toContain("项目日志");
  });

  it("renders the user guide page inside the settings user-guide section", () => {
    const page = renderSettingsPage("user-guide", { anchor: "settings-layout" });
    document.body.appendChild(page);

    expect(page.querySelector("[data-settings-panel=\"user-guide\"]")?.hasAttribute("hidden")).toBe(false);
    expect(page.querySelector('[data-settings-nav="user-guide"]')?.getAttribute("data-active")).toBe("true");
    expect(page.querySelector(".user-guide-page h1")?.textContent).toContain("LLM Wiki 使用说明");
    expect(page.querySelector(".user-guide-page__sidebar")).toBeNull();
    expect(page.textContent).toContain("自动化页");
    expect(page.textContent).toContain("项目日志页");
    expect(page.querySelector<HTMLAnchorElement>(".user-guide-page__toc a")?.getAttribute("href")).toContain("#/settings/user-guide#");
  });

  it("does not overwrite edited agent fields when account options finish loading late", async () => {
    let savedBody: unknown = null;
    let resolveAccounts: ((value: Response) => void) | null = null;
    const delayedAccounts = new Promise<Response>((resolve) => {
      resolveAccounts = resolve;
    });
    vi.stubGlobal(
      "fetch",
      // fallow-ignore-next-line complexity
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === "/api/search/status") {
          return {
            ok: true,
            json: async () => ({ success: true, data: { local: { configured: true }, web: { configured: false, endpointHost: null } } }),
          } as Response;
        }
        if (url === "/api/llm/config" && !init?.method) {
          return {
            ok: true,
            json: async () => ({ success: true, data: { provider: "openai", url: "", keyConfigured: false, model: "gpt-5-codex" } }),
          } as Response;
        }
        if (url === "/api/llm/accounts") {
          return {
            ok: true,
            json: async () => ({ success: true, data: { accounts: [] } }),
          } as Response;
        }
        if (url === "/api/cliproxy/accounts") {
          return delayedAccounts;
        }
        if (url === "/api/cliproxy/accounts/models?name=codex.json") {
          return {
            ok: true,
            json: async () => ({ success: true, data: { models: [{ id: "gpt-5-codex" }, { id: "gpt-4.1" }] } }),
          } as Response;
        }
        if (url === "/api/app-config" && !init?.method) {
          return {
            ok: true,
            json: async () => ({
              success: true,
              data: {
                path: "agents/agents.json",
                defaultAppId: "wiki-general",
                apps: [{
                  id: "wiki-general",
                  name: "Wiki 閫氱敤鍔╂墜",
                  purpose: "澶勭悊 Wiki 椤甸潰銆佽祫鏂欐暣鐞嗐€佷唬鐮佷笌鏂囦欢浠诲姟",
                  provider: "openai",
                  accountRef: "",
                  model: "",
                  workflow: "default workflow",
                  prompt: "榛樿 Prompt",
                  enabled: true,
                  updatedAt: "2026-04-23T00:00:00.000Z",
                }],
              },
            }),
          } as Response;
        }
        if (url === "/api/app-config" && init?.method === "PUT") {
          savedBody = JSON.parse(String(init.body));
          return {
            ok: true,
            json: async () => ({ success: true, data: { ...(savedBody as object), path: "agents/agents.json" } }),
          } as Response;
        }
        throw new Error(`unexpected fetch ${url}`);
      }),
    );

    const page = renderSettingsPage();
    document.body.appendChild(page);
    await flush();
    page.querySelector<HTMLButtonElement>("[data-settings-nav=\"app-config\"]")?.click();
    await flush();

    (page.querySelector("[data-agent-config-field=\"provider\"]") as HTMLSelectElement).value = "codex-cli";
    page.querySelector<HTMLSelectElement>("[data-agent-config-field=\"provider\"]")?.dispatchEvent(new Event("change", { bubbles: true }));
    (page.querySelector("[data-agent-config-field=\"workflow\"]") as HTMLTextAreaElement).value = "鐞嗚В浠诲姟\n璇诲彇涓婁笅鏂嘰n鍥炲啓缁撴灉";
    page.querySelector<HTMLTextAreaElement>("[data-agent-config-field=\"workflow\"]")?.dispatchEvent(new Event("input", { bubbles: true }));
    (page.querySelector("[data-agent-config-field=\"prompt\"]") as HTMLTextAreaElement).value = "涓嶈鎭㈠榛樿 Prompt";
    page.querySelector<HTMLTextAreaElement>("[data-agent-config-field=\"prompt\"]")?.dispatchEvent(new Event("input", { bubbles: true }));

    resolveAccounts?.({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          accounts: [{
            name: "codex.json",
            provider: "codex",
            email: "xiaosong123413@gmail.com",
            enabled: true,
          }],
        },
      }),
    } as Response);
    await flush();

    const accountSelect = page.querySelector<HTMLSelectElement>("[data-agent-config-field=\"accountRef\"]");
    if (!accountSelect) throw new Error("Agent account select missing");
    accountSelect.value = "oauth:codex:codex.json";
    accountSelect.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();
    (page.querySelector("[data-agent-config-field=\"model\"]") as HTMLSelectElement).value = "gpt-5-codex";
    page.querySelector<HTMLButtonElement>("[data-agent-config-save]")?.click();
    await flush();

    expect(savedBody).toMatchObject({
      defaultAppId: "wiki-general",
      apps: [
        expect.objectContaining({
          id: "wiki-general",
          provider: "codex-cli",
          accountRef: "oauth:codex:codex.json",
          model: "gpt-5-codex",
          workflow: "鐞嗚В浠诲姟\n璇诲彇涓婁笅鏂嘰n鍥炲啓缁撴灉",
          prompt: "涓嶈鎭㈠榛樿 Prompt",
        }),
      ],
    });
    expect((page.querySelector("[data-agent-config-field=\"provider\"]") as HTMLSelectElement).value).toBe("codex-cli");
    expect((page.querySelector("[data-agent-config-field=\"accountRef\"]") as HTMLSelectElement).value).toBe("oauth:codex:codex.json");
    expect((page.querySelector("[data-agent-config-field=\"model\"]") as HTMLSelectElement).value).toBe("gpt-5-codex");
    expect((page.querySelector("[data-agent-config-field=\"workflow\"]") as HTMLTextAreaElement).value).toBe("鐞嗚В浠诲姟\n璇诲彇涓婁笅鏂嘰n鍥炲啓缁撴灉");
    expect((page.querySelector("[data-agent-config-field=\"prompt\"]") as HTMLTextAreaElement).value).toBe("涓嶈鎭㈠榛樿 Prompt");
  });

  it("shows relay api accounts in agent account source and preselects the only matching relay account", async () => {
    vi.stubGlobal(
      "fetch",
      // fallow-ignore-next-line complexity
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === "/api/search/status") {
          return {
            ok: true,
            json: async () => ({ success: true, data: { local: { configured: true }, web: { configured: false, endpointHost: null } } }),
          } as Response;
        }
        if (url === "/api/llm/config" && !init?.method) {
          return {
            ok: true,
            json: async () => ({ success: true, data: { provider: "openai", url: "", keyConfigured: false, model: "gpt-5-codex" } }),
          } as Response;
        }
        if (url === "/api/llm/accounts") {
          return {
            ok: true,
            json: async () => ({
              success: true,
              data: {
                accounts: [{
                  id: "relay:small-horse",
                  name: "灏忛┈涓浆",
                  provider: "relay",
                  url: "https://xiaoma.best",
                  keyConfigured: true,
                  model: "gpt-4o-mini",
                  enabled: true,
                  updatedAt: "2026-04-24T03:31:27.859Z",
                }],
              },
            }),
          } as Response;
        }
        if (url === "/api/cliproxy/accounts") {
          return {
            ok: true,
            json: async () => ({
              success: true,
              data: {
                accounts: [{
                  name: "codex.json",
                  provider: "codex",
                  email: "xiaosong123413@gmail.com",
                  enabled: true,
                }],
              },
            }),
          } as Response;
        }
        if (url === "/api/app-config" && !init?.method) {
          return {
            ok: true,
            json: async () => ({
              success: true,
              data: {
                path: "agents/agents.json",
                defaultAppId: "wiki-general",
                apps: [{
                  id: "wiki-general",
                  name: "Wiki Agent",
                  purpose: "relay agent",
                  provider: "relay",
                  accountRef: "",
                  model: "",
                  workflow: "",
                  prompt: "",
                  enabled: true,
                  updatedAt: "2026-04-24T00:00:00.000Z",
                }],
              },
            }),
          } as Response;
        }
        throw new Error(`unexpected fetch ${url}`);
      }),
    );

    const page = renderSettingsPage();
    document.body.appendChild(page);
    await flush();

    page.querySelector<HTMLButtonElement>("[data-settings-nav=\"app-config\"]")?.click();
    await flush();
    await flush();

    const accountSelect = page.querySelector<HTMLSelectElement>("[data-agent-config-field=\"accountRef\"]");
    const modelSelect = page.querySelector<HTMLSelectElement>("[data-agent-config-field=\"model\"]");
    expect(accountSelect?.textContent).toContain("灏忛┈涓浆");
    expect(accountSelect?.textContent).toContain("xiaosong123413@gmail.com");
    expect(accountSelect?.value).toBe("api:relay:small-horse");
    expect(modelSelect?.value).toBe("gpt-4o-mini");
  });

  it("saves the agent currently shown in the editor instead of a stale active id", async () => {
    let savedBody: unknown = null;
    vi.stubGlobal(
      "fetch",
      // fallow-ignore-next-line complexity
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === "/api/search/status") {
          return {
            ok: true,
            json: async () => ({ success: true, data: { local: { configured: true }, web: { configured: false, endpointHost: null } } }),
          } as Response;
        }
        if (url === "/api/llm/config" && !init?.method) {
          return {
            ok: true,
            json: async () => ({ success: true, data: { provider: "openai", url: "", keyConfigured: false, model: "gpt-5-codex" } }),
          } as Response;
        }
        if (url === "/api/llm/accounts") {
          return {
            ok: true,
            json: async () => ({ success: true, data: { accounts: [] } }),
          } as Response;
        }
        if (url === "/api/cliproxy/accounts") {
          return {
            ok: true,
            json: async () => ({ success: true, data: { accounts: [] } }),
          } as Response;
        }
        if (url === "/api/app-config" && !init?.method) {
          return {
            ok: true,
            json: async () => ({
              success: true,
              data: {
                path: "agents/agents.json",
                defaultAppId: "draft-agent",
                apps: [
                  {
                    id: "wiki-general",
                    name: "Wiki 閫氱敤鍔╂墜",
                    purpose: "澶勭悊 Wiki 椤甸潰銆佽祫鏂欐暣鐞嗐€佷唬鐮佷笌鏂囦欢浠诲姟",
                    provider: "openai",
                    accountRef: "",
                    model: "",
                    workflow: "default workflow",
                    prompt: "榛樿 Prompt",
                    enabled: true,
                    updatedAt: "2026-04-23T00:00:00.000Z",
                  },
                  {
                    id: "draft-agent",
                    name: "鏂?Agent",
                    purpose: "",
                    provider: "openai",
                    accountRef: "",
                    model: "",
                    workflow: "",
                    prompt: "",
                    enabled: true,
                    updatedAt: "2026-04-23T00:00:00.000Z",
                  },
                ],
              },
            }),
          } as Response;
        }
        if (url === "/api/app-config" && init?.method === "PUT") {
          savedBody = JSON.parse(String(init.body));
          return {
            ok: true,
            json: async () => ({ success: true, data: { ...(savedBody as object), path: "agents/agents.json" } }),
          } as Response;
        }
        throw new Error(`unexpected fetch ${url}`);
      }),
    );

    const page = renderSettingsPage();
    document.body.appendChild(page);
    await flush();
    page.querySelector<HTMLButtonElement>("[data-settings-nav=\"app-config\"]")?.click();
    await flush();

    (page.querySelector("[data-agent-config-field=\"id\"]") as HTMLInputElement).value = "wiki-general";
    (page.querySelector("[data-agent-config-field=\"provider\"]") as HTMLSelectElement).value = "codex-cli";
    (page.querySelector("[data-agent-config-field=\"model\"]") as HTMLSelectElement).value = "gpt-5-codex";
    (page.querySelector("[data-agent-config-field=\"workflow\"]") as HTMLTextAreaElement).value = "褰撳墠缂栬緫鍣ㄥ伐浣滄祦";
    (page.querySelector("[data-agent-config-field=\"prompt\"]") as HTMLTextAreaElement).value = "褰撳墠缂栬緫鍣?Prompt";
    page.querySelector<HTMLButtonElement>("[data-agent-config-save]")?.click();
    await flush();

    expect(savedBody).toMatchObject({
      defaultAppId: "wiki-general",
      apps: [
        expect.objectContaining({
          id: "wiki-general",
          provider: "codex-cli",
          model: "gpt-5-codex",
          workflow: "褰撳墠缂栬緫鍣ㄥ伐浣滄祦",
          prompt: "褰撳墠缂栬緫鍣?Prompt",
        }),
        expect.objectContaining({
          id: "draft-agent",
          provider: "openai",
        }),
      ],
    });
  });

  it("loads workspace sync config through the desktop bridge and saves the updated paths", async () => {
    const saveDesktopConfig = vi.fn(async () => ({ targetVault: "D:/Desktop/target" }));
    const saveAppConfig = vi.fn(async (payload: unknown) => payload);
    Object.defineProperty(window, "llmWikiDesktop", {
      value: {
        getAppBootstrap: vi.fn(async () => ({
          desktopConfig: { targetVault: "D:/Desktop/target" },
          appConfig: {
            accountIdentifier: "alice@example.com",
            targetRepoPath: "D:/Desktop/target",
            sourceFolders: ["D:/Desktop/source-a", "D:/Desktop/source-b"],
          },
        })),
        chooseTargetVault: vi.fn(async () => "D:/Desktop/target-2"),
        chooseSourceFolders: vi.fn(async () => ["D:/Desktop/source-c"]),
        saveDesktopConfig,
        saveAppConfig,
      },
      configurable: true,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === "/api/search/status") {
          return {
            ok: true,
            json: async () => ({
              success: true,
              data: {
                local: { configured: true },
                web: { configured: false, endpointHost: null },
              },
            }),
          } as Response;
        }
        if (url === "/api/import/xiaohongshu/progress") {
          return {
            ok: true,
            json: async () => ({ success: true, taskId: null, progress: 0, status: "idle", message: "not started", hasCookie: false }),
          } as Response;
        }
        throw new Error(`unexpected fetch ${url}`);
      }),
    );

    const page = renderSettingsPage();
    document.body.appendChild(page);
    await flush();
    page.querySelector<HTMLButtonElement>("[data-settings-nav=\"workspace-sync\"]")?.click();
    await flush();
    expect((page.querySelector("[data-sync-target-input]") as HTMLInputElement).value).toBe("D:/Desktop/target");
    expect(page.querySelector("[data-sync-source-paths]")?.textContent).toContain("D:/Desktop/source-a");
    expect(page.querySelector("[data-sync-source-paths]")?.textContent).toContain("D:/Desktop/source-b");

    page.querySelector<HTMLButtonElement>("[data-sync-target-pick]")?.click();
    await flush();
    expect((page.querySelector("[data-sync-target-input]") as HTMLInputElement).value).toBe("D:/Desktop/target-2");

    page.querySelector<HTMLButtonElement>("[data-sync-source-pick]")?.click();
    await flush();
    expect((page.querySelector("[data-sync-source-input]") as HTMLInputElement).value).toBe(
      "D:/Desktop/source-a; D:/Desktop/source-b; D:/Desktop/source-c",
    );
    expect(page.querySelector("[data-sync-source-paths]")?.textContent).toContain("D:/Desktop/source-c");

    page.querySelector<HTMLButtonElement>("[data-sync-remove-source=\"D:/Desktop/source-a\"]")?.click();
    await flush();
    expect(page.querySelector("[data-sync-source-paths]")?.textContent).not.toContain("D:/Desktop/source-a");

    page.querySelector<HTMLButtonElement>("[data-sync-config-save]")?.click();
    await flush();
    expect(saveDesktopConfig).toHaveBeenCalledWith("D:/Desktop/target-2");
    expect(saveAppConfig).toHaveBeenCalledWith({
      accountIdentifier: "alice@example.com",
      targetRepoPath: "D:/Desktop/target-2",
      sourceFolders: ["D:/Desktop/source-b", "D:/Desktop/source-c"],
    });
  });

  it("opens the xiaohongshu modal and saves cookie while polling import progress", async () => {
    const calls: string[] = [];
    const chooseTargetVault = vi.fn(async () => "D:/Desktop/xhs-import");
    Object.defineProperty(window, "llmWikiDesktop", {
      value: {
        chooseTargetVault,
      },
      configurable: true,
    });
    vi.stubGlobal(
      "fetch",
      // fallow-ignore-next-line complexity
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        calls.push(`${init?.method ?? "GET"} ${url}`);
        if (url === "/api/search/status") {
          return {
            ok: true,
            json: async () => ({
              success: true,
              data: {
                local: { configured: true },
                web: { configured: false, endpointHost: null },
              },
            }),
          } as Response;
        }
        if (url === "/api/sync/config") {
          return {
            ok: true,
            json: async () => ({
              success: true,
              data: {
                targetRepoPath: "D:/Desktop/target",
                sourceRepoPaths: ["D:/Desktop/target/raw"],
              },
            }),
          } as Response;
        }
        if (url === "/api/import/xiaohongshu/progress") {
          return {
            ok: true,
            json: async () => ({
              success: true,
              taskId: null,
              progress: 0,
              status: "idle",
              message: "not started",
              hasCookie: false,
              importDirPath: "D:/Desktop/xhs-import-current",
            }),
          } as Response;
        }
        if (url === "/api/import/xiaohongshu/config") {
          if (!init?.method || init.method === "GET") {
            return {
              ok: true,
              json: async () => ({
                success: true,
                data: {
                  importDirPath: "D:/Desktop/xhs-import-current",
                },
              }),
            } as Response;
          }
          if (init.method === "POST") {
            return {
              ok: true,
              json: async () => ({
                success: true,
                message: "瀵煎叆鏂囦欢澶瑰凡淇濆瓨",
                data: {
                  importDirPath: "D:/Desktop/xhs-import",
                },
              }),
            } as Response;
          }
          if (init.method === "DELETE") {
            return {
              ok: true,
              json: async () => ({
                success: true,
                message: "瀵煎叆鏂囦欢澶瑰凡鍒犻櫎",
              }),
            } as Response;
          }
        }
        if (url === "/api/import/xiaohongshu/cookie" && init?.method === "POST") {
          return {
            ok: true,
            json: async () => ({ success: true, message: "cookie 淇濆瓨鎴愬姛" }),
          } as Response;
        }
        if (url === "/api/import/xiaohongshu/start" && init?.method === "POST") {
          return {
            ok: true,
            json: async () => ({ success: true, taskId: "task-xhs-1" }),
          } as Response;
        }
        if (url === "/api/import/xiaohongshu/progress?taskId=task-xhs-1") {
          return {
            ok: true,
            json: async () => ({
              success: true,
              taskId: "task-xhs-1",
              progress: 100,
              status: "success",
              message: "瀵煎叆鐜宸插氨缁紝鍙互寮€濮嬪皬绾功瀵煎叆",
              hasCookie: true,
              importDirPath: "D:/Desktop/xhs-import",
            }),
          } as Response;
        }
        if (url === "/api/xhs-sync/favorites" && init?.method === "POST") {
          return {
            ok: true,
            json: async () => ({
              success: true,
              data: {
                status: "completed",
                scanned: 3,
                skipped: 1,
                queued: 2,
                message: "detected 3 links, skipped 1 already synced, synced 2 / 2",
                progress: { current: 2, total: 2, percent: 100 },
              },
            }),
          } as Response;
        }
        throw new Error(`unexpected fetch ${url}`);
      }),
    );

    const page = renderSettingsPage();
    document.body.appendChild(page);
    await flush();
    page.querySelector<HTMLButtonElement>("[data-settings-nav=\"workspace-sync\"]")?.click();
    await flush();

    showElement(page, "[data-xhs-import-modal]");
    await flush();
    expect(page.querySelector("[data-xhs-import-modal]")?.hasAttribute("hidden")).toBe(false);
    expect(page.querySelector("[data-xhs-import-status]")?.textContent).toContain("not started");
    expect((page.querySelector("[data-xhs-import-dir-input]") as HTMLInputElement).value).toBe("D:/Desktop/xhs-import-current");

    page.querySelector<HTMLButtonElement>("[data-xhs-import-dir-pick]")?.click();
    await flush();
    expect(chooseTargetVault).toHaveBeenCalled();
    expect((page.querySelector("[data-xhs-import-dir-input]") as HTMLInputElement).value).toBe("D:/Desktop/xhs-import");

    page.querySelector<HTMLButtonElement>("[data-xhs-import-dir-save]")?.click();
    await flush();
    expect(calls).toContain("POST /api/import/xiaohongshu/config");

    page.querySelector<HTMLTextAreaElement>("[data-xhs-cookie-input]")!.value = "a=1; web_session=2";
    page.querySelector<HTMLButtonElement>("[data-xhs-cookie-save]")?.click();
    await flush();
    await flush();

    expect(calls).toContain("POST /api/import/xiaohongshu/cookie");
    expect(calls).toContain("POST /api/import/xiaohongshu/start");
    expect(calls).toContain("GET /api/import/xiaohongshu/progress?taskId=task-xhs-1");
    expect(page.querySelector<HTMLElement>("[data-xhs-import-progress]")?.style.width).toBe("100%");
    expect(page.querySelector("[data-xhs-import-status]")?.textContent?.trim()).not.toBe("");

    page.querySelector<HTMLButtonElement>("[data-xhs-import-sync]")?.click();
    await flush();
    expect(calls).toContain("POST /api/xhs-sync/favorites");
    expect(page.querySelector("[data-xhs-import-status]")?.textContent).toContain("skipped 1");

    page.querySelector<HTMLButtonElement>("[data-xhs-import-dir-clear]")?.click();
    await flush();
    expect(calls).toContain("DELETE /api/import/xiaohongshu/config");
    expect((page.querySelector("[data-xhs-import-dir-input]") as HTMLInputElement).value).toBe("");
  });

  it("imports xiaohongshu cookie from the desktop browser session", async () => {
    const calls: string[] = [];
    const openXiaohongshuLogin = vi.fn(async () => ({
      ok: true,
      message: "opened xiaohongshu login window",
    }));
    const importXiaohongshuCookie = vi.fn(async () => ({
      ok: true,
      cookie: "web_session=desktop-cookie; a=1",
      count: 2,
      message: "read 2 xiaohongshu cookies",
    }));
    Object.defineProperty(window, "llmWikiDesktop", {
      value: {
        openXiaohongshuLogin,
        importXiaohongshuCookie,
      },
      configurable: true,
    });
    vi.stubGlobal(
      "fetch",
      // fallow-ignore-next-line complexity
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        calls.push(`${init?.method ?? "GET"} ${url}`);
        if (url === "/api/search/status") {
          return {
            ok: true,
            json: async () => ({ success: true, data: { local: { configured: true }, web: { configured: false, endpointHost: null } } }),
          } as Response;
        }
        if (url === "/api/llm/config") {
          return {
            ok: true,
            json: async () => ({ success: true, data: { provider: "openai", url: "", keyConfigured: false, model: "gpt-5-codex" } }),
          } as Response;
        }
        if (url === "/api/llm/accounts") {
          return {
            ok: true,
            json: async () => ({ success: true, data: { accounts: [] } }),
          } as Response;
        }
        if (url === "/api/cliproxy/accounts") {
          return {
            ok: true,
            json: async () => ({ success: true, data: { accounts: [] } }),
          } as Response;
        }
        if (url === "/api/sync/config") {
          return {
            ok: true,
            json: async () => ({ success: true, data: { targetRepoPath: "", sourceRepoPaths: [] } }),
          } as Response;
        }
        if (url === "/api/import/xiaohongshu/config") {
          return {
            ok: true,
            json: async () => ({ success: true, data: { importDirPath: "" } }),
          } as Response;
        }
        if (url === "/api/import/xiaohongshu/progress") {
          return {
            ok: true,
            json: async () => ({ success: true, taskId: null, progress: 0, status: "idle", message: "not started", hasCookie: false, importDirPath: "" }),
          } as Response;
        }
        if (url === "/api/import/xiaohongshu/cookie" && init?.method === "POST") {
          expect(String(init.body)).toContain("desktop-cookie");
          return {
            ok: true,
            json: async () => ({ success: true, message: "cookie 淇濆瓨鎴愬姛" }),
          } as Response;
        }
        if (url === "/api/import/xiaohongshu/start" && init?.method === "POST") {
          return {
            ok: true,
            json: async () => ({ success: true, taskId: "task-xhs-cookie" }),
          } as Response;
        }
        if (url === "/api/import/xiaohongshu/progress?taskId=task-xhs-cookie") {
          return {
            ok: true,
            json: async () => ({ success: true, taskId: "task-xhs-cookie", progress: 100, status: "success", message: "瀵煎叆瀹屾垚", hasCookie: true, importDirPath: "" }),
          } as Response;
        }
        throw new Error(`unexpected fetch ${url}`);
      }),
    );

    const page = renderSettingsPage();
    document.body.appendChild(page);
    await flush();
    page.querySelector<HTMLButtonElement>("[data-settings-nav=\"workspace-sync\"]")?.click();
    await flush();
    showElement(page, "[data-xhs-import-modal]");
    await flush();

    page.querySelector<HTMLButtonElement>("[data-xhs-login-open]")?.click();
    await flush();

    page.querySelector<HTMLButtonElement>("[data-xhs-cookie-import]")?.click();
    await flush();
    await flush();

    expect(openXiaohongshuLogin).toHaveBeenCalledOnce();
    expect(importXiaohongshuCookie).toHaveBeenCalledOnce();
    expect((page.querySelector("[data-xhs-cookie-input]") as HTMLTextAreaElement).value).toContain("desktop-cookie");
    expect(calls).toContain("POST /api/import/xiaohongshu/cookie");
    expect(calls).toContain("POST /api/import/xiaohongshu/start");
  });

  it("syncs xiaohongshu favorites through the desktop browser bridge before batch import", async () => {
    const calls: string[] = [];
    const fetchXiaohongshuFavorites = vi.fn(async () => ({
      ok: true,
      urls: [
        "https://www.xiaohongshu.com/explore/64f000000000000001234567?xsec_token=token-a",
        "https://www.xiaohongshu.com/explore/64f000000000000007654321?xsec_token=token-b",
      ],
      count: 2,
      message: "read 2 xiaohongshu favorites",
    }));
    Object.defineProperty(window, "llmWikiDesktop", {
      value: {
        fetchXiaohongshuFavorites,
      },
      configurable: true,
    });
    vi.stubGlobal(
      "fetch",
      // fallow-ignore-next-line complexity
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        calls.push(`${init?.method ?? "GET"} ${url}`);
        if (url === "/api/search/status") {
          return {
            ok: true,
            json: async () => ({ success: true, data: { local: { configured: true }, web: { configured: false, endpointHost: null } } }),
          } as Response;
        }
        if (url === "/api/sync/config") {
          return {
            ok: true,
            json: async () => ({ success: true, data: { targetRepoPath: "", sourceRepoPaths: [] } }),
          } as Response;
        }
        if (url === "/api/import/xiaohongshu/config") {
          return {
            ok: true,
            json: async () => ({ success: true, data: { importDirPath: "D:/Desktop/xhs-import" } }),
          } as Response;
        }
        if (url === "/api/import/xiaohongshu/progress") {
          return {
            ok: true,
            json: async () => ({ success: true, taskId: null, progress: 0, status: "idle", message: "not started", hasCookie: true, importDirPath: "D:/Desktop/xhs-import" }),
          } as Response;
        }
        if (url === "/api/xhs-sync/batch" && init?.method === "POST") {
          expect(String(init.body)).toContain("64f000000000000001234567");
          expect(String(init.body)).toContain("64f000000000000007654321");
          return {
            ok: true,
            json: async () => ({
              success: true,
              data: {
                status: "completed",
                queued: 2,
                skipped: 0,
                message: "synced 2 favorites",
                progress: { current: 2, total: 2, percent: 100 },
              },
            }),
          } as Response;
        }
        throw new Error(`unexpected fetch ${url}`);
      }),
    );

    const page = renderSettingsPage();
    document.body.appendChild(page);
    await flush();
    page.querySelector<HTMLButtonElement>("[data-settings-nav=\"workspace-sync\"]")?.click();
    await flush();
    showElement(page, "[data-xhs-import-modal]");
    await flush();
    page.querySelector<HTMLButtonElement>("[data-xhs-import-sync]")?.click();
    await flush();
    await flush();

    expect(fetchXiaohongshuFavorites).toHaveBeenCalledOnce();
    expect(calls).toContain("POST /api/xhs-sync/batch");
    expect(calls).not.toContain("POST /api/xhs-sync/favorites");
    expect(page.textContent).toContain("synced 2 favorites");
  });

  it("keeps the selected xiaohongshu import folder when progress has no saved path yet", async () => {
    const chooseTargetVault = vi.fn(async () => "D:/Desktop/new-xhs-import");
    Object.defineProperty(window, "llmWikiDesktop", {
      value: {
        chooseTargetVault,
      },
      configurable: true,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === "/api/search/status") {
          return {
            ok: true,
            json: async () => ({ success: true, data: { local: { configured: true }, web: { configured: false, endpointHost: null } } }),
          } as Response;
        }
        if (url === "/api/sync/config") {
          return {
            ok: true,
            json: async () => ({ success: true, data: { targetRepoPath: "", sourceRepoPaths: [] } }),
          } as Response;
        }
        if (url === "/api/import/xiaohongshu/config") {
          return {
            ok: true,
            json: async () => ({ success: true, data: { importDirPath: "" } }),
          } as Response;
        }
        if (url === "/api/import/xiaohongshu/progress") {
          return {
            ok: true,
            json: async () => ({ success: true, taskId: null, progress: 0, status: "idle", message: "not started", hasCookie: false, importDirPath: "" }),
          } as Response;
        }
        throw new Error(`unexpected fetch ${url}`);
      }),
    );

    const page = renderSettingsPage();
    document.body.appendChild(page);
    await flush();
    page.querySelector<HTMLButtonElement>("[data-settings-nav=\"workspace-sync\"]")?.click();
    await flush();
    showElement(page, "[data-xhs-import-modal]");
    await flush();

    page.querySelector<HTMLButtonElement>("[data-xhs-import-dir-pick]")?.click();
    await flush();

    expect((page.querySelector("[data-xhs-import-dir-input]") as HTMLInputElement).value).toBe("D:/Desktop/new-xhs-import");
  });

  it("keeps pasted xiaohongshu cookie when the modal is reopened", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === "/api/search/status") {
          return {
            ok: true,
            json: async () => ({ success: true, data: { local: { configured: true }, web: { configured: false, endpointHost: null } } }),
          } as Response;
        }
        if (url === "/api/sync/config") {
          return {
            ok: true,
            json: async () => ({ success: true, data: { targetRepoPath: "", sourceRepoPaths: [] } }),
          } as Response;
        }
        if (url === "/api/import/xiaohongshu/config") {
          return {
            ok: true,
            json: async () => ({ success: true, data: { importDirPath: "" } }),
          } as Response;
        }
        if (url === "/api/import/xiaohongshu/progress") {
          return {
            ok: true,
            json: async () => ({ success: true, taskId: null, progress: 0, status: "idle", message: "not started", hasCookie: false, importDirPath: "" }),
          } as Response;
        }
        throw new Error(`unexpected fetch ${url}`);
      }),
    );

    const page = renderSettingsPage();
    document.body.appendChild(page);
    await flush();
    page.querySelector<HTMLButtonElement>("[data-settings-nav=\"workspace-sync\"]")?.click();
    await flush();
    showElement(page, "[data-xhs-import-modal]");
    await flush();

    const cookieInput = page.querySelector<HTMLTextAreaElement>("[data-xhs-cookie-input]")!;
    cookieInput.value = "web_session=keep-me";
    cookieInput.dispatchEvent(new Event("input", { bubbles: true }));
    page.querySelector<HTMLButtonElement>("[data-xhs-import-close]")?.click();
    showElement(page, "[data-xhs-import-modal]");
    await flush();

    expect((page.querySelector("[data-xhs-cookie-input]") as HTMLTextAreaElement).value).toBe("web_session=keep-me");
  });

  it("imports douyin cookie from the desktop browser session and saves it to project fallback", async () => {
    const calls: string[] = [];
    const openDouyinLogin = vi.fn(async () => ({
      ok: true,
      message: "opened douyin login window",
    }));
    const importDouyinCookie = vi.fn(async () => ({
      ok: true,
      cookie: "sessionid_ss=douyin-cookie; uid_tt=1",
      count: 2,
      message: "read 2 douyin cookies",
    }));
    Object.defineProperty(window, "llmWikiDesktop", {
      value: {
        openDouyinLogin,
        importDouyinCookie,
      },
      configurable: true,
    });
    vi.stubGlobal(
      "fetch",
      // fallow-ignore-next-line complexity
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        calls.push(`${init?.method ?? "GET"} ${url}`);
        if (url === "/api/search/status") {
          return {
            ok: true,
            json: async () => ({ success: true, data: { local: { configured: true }, web: { configured: false, endpointHost: null } } }),
          } as Response;
        }
        if (url === "/api/sync/config") {
          return {
            ok: true,
            json: async () => ({ success: true, data: { targetRepoPath: "", sourceRepoPaths: [] } }),
          } as Response;
        }
        if (url === "/api/import/douyin/cookie" && (!init?.method || init.method === "GET")) {
          return {
            ok: true,
            json: async () => ({ success: true, data: { hasCookie: false, path: "D:/Desktop/project/.llmwiki/douyin-cookie.txt" } }),
          } as Response;
        }
        if (url === "/api/import/douyin/cookie" && init?.method === "POST") {
          expect(String(init.body)).toContain("douyin-cookie");
          return {
            ok: true,
            json: async () => ({
              success: true,
              message: "douyin cookie saved",
              data: { hasCookie: true, path: "D:/Desktop/project/.llmwiki/douyin-cookie.txt" },
            }),
          } as Response;
        }
        throw new Error(`unexpected fetch ${url}`);
      }),
    );

    const page = renderSettingsPage();
    document.body.appendChild(page);
    await flush();
    page.querySelector<HTMLButtonElement>("[data-settings-nav=\"workspace-sync\"]")?.click();
    await flush();
    showElement(page, "[data-douyin-cookie-modal]");
    await flush();

    expect(page.querySelector("[data-douyin-cookie-modal]")?.hasAttribute("hidden")).toBe(false);
    expect(page.querySelector("[data-douyin-cookie-status]")?.textContent).toContain("未开始");

    page.querySelector<HTMLButtonElement>("[data-douyin-login-open]")?.click();
    await flush();

    page.querySelector<HTMLButtonElement>("[data-douyin-cookie-import]")?.click();
    await flush();
    await flush();

    expect(openDouyinLogin).toHaveBeenCalledOnce();
    expect(importDouyinCookie).toHaveBeenCalledOnce();
    expect((page.querySelector("[data-douyin-cookie-input]") as HTMLTextAreaElement).value).toContain("douyin-cookie");
    expect(calls).toContain("POST /api/import/douyin/cookie");
    expect(page.querySelector("[data-douyin-cookie-light]")?.textContent).toContain("保存");
    expect(page.querySelector("[data-douyin-cookie-path]")?.textContent).toContain("douyin-cookie.txt");
  });
});

function queryRequired<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Missing element: ${selector}`);
  return element;
}

function showElement(root: ParentNode, selector: string): void {
  queryRequired<HTMLElement>(root, selector).hidden = false;
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function createSilentEventSourceStub(): typeof EventSource {
  class SilentEventSource {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSED = 2;

    readonly url: string;
    readonly withCredentials = false;
    readyState = SilentEventSource.OPEN;

    constructor(url: string | URL) {
      this.url = String(url);
    }

    addEventListener(): void {}

    removeEventListener(): void {}

    close(): void {
      this.readyState = SilentEventSource.CLOSED;
    }
  }

  return SilentEventSource as unknown as typeof EventSource;
}
