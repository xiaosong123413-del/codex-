import { beforeEach, describe, expect, it, vi } from "vitest";
import { startAccountCodexOAuth } from "../web/server/services/account-ai-sync.js";

const { fetchWithOptionalProxyMock } = vi.hoisted(() => ({
  fetchWithOptionalProxyMock: vi.fn(),
}));

vi.mock("../src/utils/proxy-fetch.js", () => ({
  fetchWithOptionalProxy: fetchWithOptionalProxyMock,
}));

describe("account AI sync service", () => {
  beforeEach(() => {
    fetchWithOptionalProxyMock.mockReset();
  });

  it("uses the proxy-aware fetch path for account Worker OAuth requests", async () => {
    fetchWithOptionalProxyMock.mockResolvedValue(new Response(JSON.stringify({
      url: "https://auth.example.com",
      state: "oauth-state",
      userCode: "ABCD",
      pollIntervalSeconds: 2,
    }), { status: 200 }));
    const env = {
      CLOUDFLARE_WORKER_URL: "https://worker.example.com",
      CLOUDFLARE_ACCOUNT_SESSION_TOKEN: "session-token",
      GLOBAL_AGENT_HTTP_PROXY: "http://127.0.0.1:7890",
    };

    const result = await startAccountCodexOAuth(env);

    expect(result).toMatchObject({ state: "oauth-state", userCode: "ABCD" });
    expect(fetchWithOptionalProxyMock).toHaveBeenCalledWith(
      "https://worker.example.com/user/ai/codex-oauth/start",
      expect.objectContaining({ method: "POST" }),
      env,
    );
  });

  it("wraps account Worker network failures with an actionable message", async () => {
    await expect(startAccountCodexOAuth(
      {
        CLOUDFLARE_WORKER_URL: "https://worker.example.com",
        CLOUDFLARE_ACCOUNT_SESSION_TOKEN: "session-token",
      },
      async () => {
        throw new Error("fetch failed");
      },
    )).rejects.toThrow("账号 Worker 请求失败：fetch failed。请检查网络和账号登录状态。");
  });
});
