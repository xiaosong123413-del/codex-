import { afterEach, describe, expect, it, vi } from "vitest";
import { handleCodexQuotaReaderRead } from "../web/server/routes/codex-quota-reader.js";

describe("Codex quota reader route", () => {
  afterEach(() => {
    delete process.env.CODEX_QUOTA_READER_TOKEN;
    vi.unstubAllGlobals();
  });

  it("reads Codex quota with a bearer-protected request", async () => {
    process.env.CODEX_QUOTA_READER_TOKEN = "reader-secret";
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe("https://chatgpt.com/backend-api/wham/usage");
      return new Response(JSON.stringify({
        primary_window: { used_percent: 20, resets_at: "2026-04-28T12:00:00Z" },
        secondary_window: { used_percent: 50, resets_at: "2026-05-05T12:00:00Z" },
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const json = vi.fn();
    const status = vi.fn(() => ({ json }));

    await handleCodexQuotaReaderRead()({
      body: { accessToken: "access-token", refreshToken: "refresh-token", accountId: "account-id" },
      header: (name: string) => name.toLowerCase() === "authorization" ? "Bearer reader-secret" : undefined,
    } as never, { json, status } as never);

    expect(status).not.toHaveBeenCalled();
    expect(json).toHaveBeenCalledWith(expect.objectContaining({
      ok: true,
      accessToken: "access-token",
      refreshToken: "refresh-token",
      accountId: "account-id",
      quota: expect.objectContaining({
        primaryWindow: { usedPercent: 20, resetsAt: "2026-04-28T12:00:00Z" },
        secondaryWindow: { usedPercent: 50, resetsAt: "2026-05-05T12:00:00Z" },
      }),
    }));
  });

  it("refreshes a Codex token when the first quota request is rejected", async () => {
    process.env.CODEX_QUOTA_READER_TOKEN = "reader-secret";
    const idToken = makeJwt({
      email: "me@example.com",
      "https://api.openai.com/auth": {
        chatgpt_account_id: "new-account-id",
      },
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "https://chatgpt.com/backend-api/wham/usage" && fetchMock.mock.calls.length === 1) {
        return new Response(JSON.stringify({ error: "forbidden" }), {
          status: 403,
          headers: { "content-type": "application/json" },
        });
      }
      if (String(input) === "https://auth.openai.com/oauth/token") {
        return new Response(JSON.stringify({
          access_token: "new-access-token",
          refresh_token: "new-refresh-token",
          id_token: idToken,
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (String(input) === "https://chatgpt.com/backend-api/wham/usage") {
        return new Response(JSON.stringify({
          rate_limit: {
            primary_window: { used_percent: 10, resets_at: null },
          },
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`unexpected ${String(input)}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const json = vi.fn();
    const status = vi.fn(() => ({ json }));

    await handleCodexQuotaReaderRead()({
      body: { accessToken: "old-access-token", refreshToken: "old-refresh-token" },
      header: (name: string) => name.toLowerCase() === "authorization" ? "Bearer reader-secret" : undefined,
    } as never, { json, status } as never);

    expect(json).toHaveBeenCalledWith(expect.objectContaining({
      ok: true,
      accessToken: "new-access-token",
      refreshToken: "new-refresh-token",
      accountId: "new-account-id",
      email: "me@example.com",
    }));
  });

  it("rejects unauthenticated quota reader calls", async () => {
    process.env.CODEX_QUOTA_READER_TOKEN = "reader-secret";
    const json = vi.fn();
    const status = vi.fn(() => ({ json }));

    await handleCodexQuotaReaderRead()({
      body: {},
      header: () => undefined,
    } as never, { json, status } as never);

    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith({ ok: false, error: "unauthorized" });
  });
});

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
