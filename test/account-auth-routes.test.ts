/**
 * Tests the WebUI account-auth proxy routes used by ordinary browsers.
 *
 * These routes keep provider secrets in the Worker while allowing the local
 * web page to start WeChat OAuth and exchange the callback code for the shared
 * account session used by desktop and mobile clients.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerAccountAuthRoutes } from "../web/server/routes/account-auth.js";

interface TestRoute {
  path: string;
  handler: (
    req: { body?: Record<string, unknown> },
    res: {
      json: (body: unknown) => void;
      status: (code: number) => { json: (body: unknown) => void };
    },
  ) => Promise<void>;
}

describe("account auth routes", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("proxies WeChat authorize URL requests to the configured Worker", async () => {
    vi.stubEnv("CLOUDFLARE_WORKER_URL", "https://worker.example.com/");
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true, url: "https://open.weixin.qq.com/connect/qrconnect" }));
    vi.stubGlobal("fetch", fetchMock);
    const route = registerPostRoutes().find((item) => item.path === "/api/account-auth/wechat/authorize-url");
    const json = vi.fn();
    const status = vi.fn((code: number) => ({ json: (body: unknown) => json({ status: code, body }) }));

    await route?.handler(
      { body: { redirectUri: "http://localhost:4175/", state: "state-one" } },
      { json, status },
    );

    expect(fetchMock).toHaveBeenCalledWith("https://worker.example.com/auth/wechat/authorize-url", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ redirectUri: "http://localhost:4175/", state: "state-one" }),
    });
    expect(json).toHaveBeenCalledWith({
      status: 200,
      body: {
        success: true,
        data: { ok: true, url: "https://open.weixin.qq.com/connect/qrconnect" },
        error: undefined,
      },
    });
  });

  it("returns a shared account session from the WeChat login proxy", async () => {
    vi.stubEnv("CLOUDFLARE_WORKER_URL", "https://worker.example.com");
    const workerPayload = {
      ok: true,
      user: { id: "account-one" },
      session: { token: "session-token", expiresAt: "2026-05-31T00:00:00.000Z" },
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(workerPayload));
    vi.stubGlobal("fetch", fetchMock);
    const route = registerPostRoutes().find((item) => item.path === "/api/account-auth/wechat/login");
    const json = vi.fn();
    const status = vi.fn((code: number) => ({ json: (body: unknown) => json({ status: code, body }) }));

    await route?.handler({ body: { code: "wechat-code", clientType: "web" } }, { json, status });

    expect(fetchMock).toHaveBeenCalledWith("https://worker.example.com/auth/wechat/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: "wechat-code", clientType: "web" }),
    });
    expect(json).toHaveBeenCalledWith({
      status: 200,
      body: {
        success: true,
        data: workerPayload,
        error: undefined,
      },
    });
  });

  it("proxies mini-program QR login polling to the Worker", async () => {
    vi.stubEnv("CLOUDFLARE_WORKER_URL", "https://worker.example.com");
    const workerPayload = { ok: true, status: "pending", expiresAt: "2026-05-01T12:05:00.000Z" };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(workerPayload));
    vi.stubGlobal("fetch", fetchMock);
    const route = registerPostRoutes().find((item) => item.path === "/api/account-auth/wechat/mini-login/poll");
    const json = vi.fn();
    const status = vi.fn((code: number) => ({ json: (body: unknown) => json({ status: code, body }) }));

    await route?.handler({ body: { loginId: "login-one", pollToken: "poll-token" } }, { json, status });

    expect(fetchMock).toHaveBeenCalledWith("https://worker.example.com/auth/wechat/mini-login/poll", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ loginId: "login-one", pollToken: "poll-token" }),
    });
    expect(json).toHaveBeenCalledWith({
      status: 200,
      body: {
        success: true,
        data: workerPayload,
        error: undefined,
      },
    });
  });
});

function registerPostRoutes(): TestRoute[] {
  const routes: TestRoute[] = [];
  const app = {
    post(path: string, handler: TestRoute["handler"]) {
      routes.push({ path, handler });
      return app;
    },
  };
  registerAccountAuthRoutes(app as never);
  return routes;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
