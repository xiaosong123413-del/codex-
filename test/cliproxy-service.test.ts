import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  buildCLIProxyConfig,
  getCLIProxyCodexAccounts,
  getCLIProxyOAuthAccounts,
  getCLIProxyOAuthStatus,
  getCLIProxyStatus,
  installCLIProxySource,
  requestCLIProxyOAuth,
  startCLIProxy,
  syncCLIProxyCodexTokenToWorker,
  type CLIProxyCommandRunner,
  type CLIProxyFetcher,
} from "../web/server/services/cliproxy.js";

describe("CLIProxyAPI service", () => {
  it("creates a wiki-owned config with localhost management and auth storage", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "llmwiki-cliproxy-"));
    const config = buildCLIProxyConfig(root, {
      port: 8317,
      managementKey: "wiki-management-key",
      clientKey: "wiki-client-key",
      proxyUrl: "http://127.0.0.1:7890",
    });

    expect(config.configPath).toBe(path.join(root, ".llmwiki", "cliproxyapi", "config.yaml"));
    expect(config.authDir).toBe(path.join(root, ".llmwiki", "cliproxyapi", "auths"));
    expect(config.proxyBaseUrl).toBe("http://127.0.0.1:8317/v1");
    expect(config.yaml).toContain("host: \"127.0.0.1\"");
    expect(config.yaml).toContain("secret-key: \"wiki-management-key\"");
    expect(config.yaml).toContain("auth-dir:");
    expect(config.yaml).toContain("api-keys:");
    expect(config.yaml).toContain("- \"wiki-client-key\"");
    expect(config.yaml).toContain("proxy-url: \"http://127.0.0.1:7890\"");
  });

  it("installs the CLIProxyAPI source into tools/CLIProxyAPI", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "llmwiki-cliproxy-install-"));
    const commands: Array<{ command: string; args: readonly string[]; cwd?: string }> = [];
    const runner: CLIProxyCommandRunner = async (command, args, options) => {
      commands.push({ command, args, cwd: options?.cwd });
      return { stdout: "ok", stderr: "" };
    };

    const result = await installCLIProxySource(root, runner);

    expect(result.sourceDir).toBe(path.join(root, "tools", "CLIProxyAPI"));
    expect(commands[0]).toEqual({
      command: "git",
      args: ["clone", "https://github.com/router-for-me/CLIProxyAPI.git", path.join(root, "tools", "CLIProxyAPI")],
      cwd: root,
    });
  });

  it("starts the embedded Go server and points wiki LLM config at it", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "llmwiki-cliproxy-start-"));
    fs.mkdirSync(path.join(root, "tools", "CLIProxyAPI"), { recursive: true });
    fs.writeFileSync(path.join(root, "tools", "CLIProxyAPI", "go.mod"), "module test\n", "utf8");
    const commands: Array<{ command: string; args: readonly string[]; cwd?: string }> = [];
    const runner: CLIProxyCommandRunner = async (command, args, options) => {
      commands.push({ command, args, cwd: options?.cwd });
      return { stdout: "started", stderr: "" };
    };

    const result = await startCLIProxy(root, {
      port: 8319,
      managementKey: "wiki-management-key",
      clientKey: "wiki-client-key",
      model: "gpt-5-codex",
    }, runner);

    expect(result.running).toBe(true);
    expect(result.proxyBaseUrl).toBe("http://127.0.0.1:8319/v1");
    expect(process.env.LLMWIKI_OPENAI_BASE_URL).toBe("http://127.0.0.1:8319/v1");
    expect(process.env.OPENAI_API_KEY).toBe("wiki-client-key");
    expect(commands[0]).toEqual({
      command: "go",
      args: ["run", "./cmd/server", "--config", path.join(root, ".llmwiki", "cliproxyapi", "config.yaml")],
      cwd: path.join(root, "tools", "CLIProxyAPI"),
    });
  });

  it("reads health and account list through wiki-owned management proxy", async () => {
    const fetcher = vi.fn<CLIProxyFetcher>(async (url, init) => {
      if (String(url) === "http://127.0.0.1:8317/healthz") {
        return jsonResponse(200, { status: "ok" });
      }
      if (String(url) === "http://127.0.0.1:8317/v0/management/auth-files") {
        expect(init?.headers).toEqual({ Authorization: "Bearer wiki-management-key" });
        return jsonResponse(200, {
          files: [
            { name: "codex.json", provider: "codex", email: "me@example.com", status: "ok" },
          ],
        });
      }
      throw new Error(`unexpected ${String(url)}`);
    });

    const status = await getCLIProxyStatus({
      port: 8317,
      managementKey: "wiki-management-key",
    }, fetcher);

    expect(status.running).toBe(true);
    expect(status.accounts).toEqual([
      { name: "codex.json", provider: "codex", email: "me@example.com", status: "ok" },
    ]);
  });

  it("starts OAuth through the CLIProxyAPI management API", async () => {
    const fetcher = vi.fn<CLIProxyFetcher>(async (url, init) => {
      expect(String(url)).toBe("http://127.0.0.1:8317/v0/management/codex-auth-url?is_webui=1");
      expect(init?.headers).toEqual({ Authorization: "Bearer wiki-management-key" });
      return jsonResponse(200, { status: "ok", url: "https://auth.example.com", state: "codex-state" });
    });

    await expect(requestCLIProxyOAuth({
      port: 8317,
      managementKey: "wiki-management-key",
      provider: "codex",
    }, fetcher)).resolves.toEqual({
      url: "https://auth.example.com",
      state: "codex-state",
    });
  });

  it("reads OAuth completion status through the management API", async () => {
    const fetcher = vi.fn<CLIProxyFetcher>(async (url, init) => {
      expect(String(url)).toBe("http://127.0.0.1:8317/v0/management/get-auth-status?state=codex-state");
      expect(init?.headers).toEqual({ Authorization: "Bearer wiki-management-key" });
      return jsonResponse(200, { status: "error", error: "Failed to exchange authorization code for tokens" });
    });

    await expect(getCLIProxyOAuthStatus({
      port: 8317,
      managementKey: "wiki-management-key",
      state: "codex-state",
    }, fetcher)).resolves.toEqual({
      status: "error",
      error: "Failed to exchange authorization code for tokens",
    });
  });

  it("lists Codex accounts with 5h and 1w quota windows", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "llmwiki-cliproxy-codex-"));
    const authDir = path.join(root, ".llmwiki", "cliproxyapi", "auths");
    fs.mkdirSync(authDir, { recursive: true });
    fs.writeFileSync(path.join(authDir, "codex.json"), JSON.stringify({
      type: "codex",
      access_token: "access-token",
      account_id: "account-id",
    }), "utf8");
    const fetcher = vi.fn<CLIProxyFetcher>(async (url, init) => {
      if (String(url) === "http://127.0.0.1:8317/v0/management/auth-files") {
        return jsonResponse(200, {
          files: [
            { name: "codex.json", provider: "codex", email: "me@example.com", disabled: false, id_token: { plan_type: "plus" } },
          ],
        });
      }
      if (String(url) === "https://chatgpt.com/backend-api/wham/usage") {
        expect(init?.headers).toEqual({
          Authorization: "Bearer access-token",
          Accept: "application/json",
          "chatgpt-account-id": "account-id",
        });
        return jsonResponse(200, {
          primary_window: { used_percent: 25, resets_at: "2026-04-23T12:00:00Z" },
          secondary_window: { used_percent: 40, resets_at: "2026-04-30T12:00:00Z" },
        });
      }
      throw new Error(`unexpected ${String(url)}`);
    });

    await expect(getCLIProxyCodexAccounts({
      projectRoot: root,
      port: 8317,
      managementKey: "wiki-management-key",
      refreshQuota: true,
    }, fetcher)).resolves.toEqual({
      accounts: [{
        name: "codex.json",
        provider: "codex",
        email: "me@example.com",
        disabled: false,
        enabled: true,
        planType: "plus",
        quota: {
          fetchedAt: expect.any(String),
          primaryWindow: { usedPercent: 25, resetsAt: "2026-04-23T12:00:00Z" },
          secondaryWindow: { usedPercent: 40, resetsAt: "2026-04-30T12:00:00Z" },
        },
      }],
    });
  });

  it("lists all OAuth accounts and only enriches Codex quota", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "llmwiki-cliproxy-oauth-"));
    const authDir = path.join(root, ".llmwiki", "cliproxyapi", "auths");
    fs.mkdirSync(authDir, { recursive: true });
    fs.writeFileSync(path.join(authDir, "codex.json"), JSON.stringify({
      type: "codex",
      access_token: "access-token",
      account_id: "account-id",
    }), "utf8");
    const fetcher = vi.fn<CLIProxyFetcher>(async (url) => {
      if (String(url) === "http://127.0.0.1:8317/v0/management/auth-files") {
        return jsonResponse(200, {
          files: [
            { name: "codex.json", provider: "codex", email: "me@example.com", disabled: false },
            { name: "gemini.json", provider: "gemini-cli", email: "gemini@example.com", status: "ok" },
          ],
        });
      }
      if (String(url) === "https://chatgpt.com/backend-api/wham/usage") {
        return jsonResponse(200, {
          primary_window: { used_percent: 25, resets_at: "2026-04-23T12:00:00Z" },
          secondary_window: { used_percent: 40, resets_at: "2026-04-30T12:00:00Z" },
        });
      }
      throw new Error(`unexpected ${String(url)}`);
    });

    await expect(getCLIProxyOAuthAccounts({
      projectRoot: root,
      port: 8317,
      managementKey: "wiki-management-key",
      refreshQuota: true,
    }, fetcher)).resolves.toEqual({
      accounts: [
        expect.objectContaining({
          name: "codex.json",
          provider: "codex",
          email: "me@example.com",
          enabled: true,
          quota: expect.objectContaining({
            primaryWindow: { usedPercent: 25, resetsAt: "2026-04-23T12:00:00Z" },
          }),
        }),
        {
          name: "gemini.json",
          provider: "gemini-cli",
          email: "gemini@example.com",
          status: "ok",
          enabled: true,
        },
      ],
    });
  });

  it("syncs a local Codex token file to the Cloudflare Worker", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "llmwiki-cliproxy-worker-sync-"));
    const authDir = path.join(root, ".llmwiki", "cliproxyapi", "auths");
    fs.mkdirSync(authDir, { recursive: true });
    fs.writeFileSync(path.join(authDir, "codex.json"), JSON.stringify({
      type: "codex",
      access_token: "access-token",
      refresh_token: "refresh-token",
      account_id: "account-id",
      email: "me@example.com",
      plan_type: "pro",
    }), "utf8");
    const fetcher = vi.fn<CLIProxyFetcher>(async (url, init) => {
      expect(String(url)).toBe("https://remote-brain.example/mobile/codex-quota/sync-token");
      expect(init?.headers).toEqual({
        Authorization: "Bearer remote-token",
        "content-type": "application/json",
      });
      expect(JSON.parse(String(init?.body))).toEqual({
        ownerUid: "owner-1",
        account: {
          name: "codex.json",
          email: "me@example.com",
          planType: "pro",
          accessToken: "access-token",
          refreshToken: "refresh-token",
          accountId: "account-id",
        },
      });
      return jsonResponse(200, { ok: true });
    });

    await expect(syncCLIProxyCodexTokenToWorker({
      projectRoot: root,
      name: "codex.json",
      ownerUid: "owner-1",
      workerUrl: "https://remote-brain.example/",
      remoteToken: "remote-token",
    }, fetcher)).resolves.toEqual({
      ok: true,
      accountName: "codex.json",
    });
  });

  it("imports the existing Codex CLI ChatGPT login when no Codex account is registered", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "llmwiki-cliproxy-codex-cli-"));
    const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "llmwiki-codex-home-"));
    const previousCodexHome = process.env.CODEX_HOME;
    process.env.CODEX_HOME = codexHome;
    const idToken = makeJwt({
      email: "me@example.com",
      "https://api.openai.com/auth": {
        chatgpt_plan_type: "pro",
      },
    });
    fs.writeFileSync(path.join(codexHome, "auth.json"), JSON.stringify({
      auth_mode: "chatgpt",
      last_refresh: "2026-04-27T05:53:47.360162Z",
      tokens: {
        id_token: idToken,
        access_token: "access-token",
        refresh_token: "refresh-token",
        account_id: "account-id",
      },
    }), "utf8");

    try {
      const fetcher = vi.fn<CLIProxyFetcher>(async (url, init) => {
        if (String(url) === "http://127.0.0.1:8317/v0/management/auth-files" && !init?.method) {
          const listCount = fetcher.mock.calls.filter(([calledUrl, calledInit]) => (
            String(calledUrl) === "http://127.0.0.1:8317/v0/management/auth-files" && !calledInit?.method
          )).length;
          return jsonResponse(200, {
            files: listCount === 1 ? [] : [
              { name: "codex-me@example.com-pro.json", provider: "codex", email: "me@example.com", disabled: false },
            ],
          });
        }
        if (String(url) === "http://127.0.0.1:8317/v0/management/auth-files?name=codex-me%40example.com-pro.json" && init?.method === "POST") {
          expect(init.headers).toEqual({
            Authorization: "Bearer wiki-management-key",
            "Content-Type": "application/json",
          });
          expect(JSON.parse(String(init.body))).toMatchObject({
            type: "codex",
            email: "me@example.com",
            access_token: "access-token",
            refresh_token: "refresh-token",
            account_id: "account-id",
            disabled: false,
          });
          return jsonResponse(200, { status: "ok" });
        }
        throw new Error(`unexpected ${String(url)}`);
      });

      await expect(getCLIProxyOAuthAccounts({
        projectRoot: root,
        port: 8317,
        managementKey: "wiki-management-key",
        refreshQuota: false,
      }, fetcher)).resolves.toEqual({
        accounts: [{
          name: "codex-me@example.com-pro.json",
          provider: "codex",
          email: "me@example.com",
          disabled: false,
          enabled: true,
        }],
      });
      expect(fs.existsSync(path.join(root, ".llmwiki", "cliproxyapi", "auths", "codex-me@example.com-pro.json"))).toBe(true);
    } finally {
      if (previousCodexHome === undefined) {
        delete process.env.CODEX_HOME;
      } else {
        process.env.CODEX_HOME = previousCodexHome;
      }
    }
  });
});

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
    headers: {
      get: (key: string) => key.toLowerCase() === "content-type" ? "application/json" : null,
    },
  } as Response;
}

function makeJwt(payload: Record<string, unknown>): string {
  return [
    base64Url(JSON.stringify({ alg: "none" })),
    base64Url(JSON.stringify(payload)),
    "signature",
  ].join(".");
}

function base64Url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64").replace(/=+$/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
