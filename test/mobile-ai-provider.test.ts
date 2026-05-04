import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createMobileCodexDirectRequest,
  runMobileAiText,
} from "../cloudflare/remote-brain-worker/src/mobile-ai-provider.js";
import {
  createDbHarness,
  createEnv,
} from "./cloudflare-remote-brain-worker-test-helpers.js";

describe("mobile ai provider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not send a duplicated Bearer prefix when the stored key includes one", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: "ok" } }],
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const text = await runMobileAiText(
      {} as Parameters<typeof runMobileAiText>[0],
      {
        mode: "api",
        apiBaseUrl: "https://xiaoma.best",
        apiKey: "Authorization: Bearer token-1",
        model: "gpt-4o",
      },
      [{ role: "user", content: "你好" }],
    );

    expect(text).toBe("ok");
    expect(fetchMock).toHaveBeenCalledWith("https://xiaoma.best/v1/chat/completions", expect.objectContaining({
      headers: expect.objectContaining({
        Authorization: "Bearer token-1",
      }),
    }));
  });

  it("uses the Worker-stored Codex OAuth token when the provider points at a local desktop proxy", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://chatgpt.com/backend-api/codex/responses");
      expect(init?.headers).toEqual(expect.objectContaining({
        Authorization: "Bearer access-token",
        "Chatgpt-Account-Id": "account-id",
        Originator: "codex-tui",
        Session_id: expect.any(String),
        "User-Agent": expect.stringContaining("codex-tui/"),
      }));
      const body = JSON.parse(String(init?.body)) as {
        model: string;
        stream: boolean;
        input: Array<{ role: string; content: Array<{ type: string; text: string }> }>;
      };
      expect(body.model).toBe("gpt-5.5");
      expect(body.stream).toBe(true);
      expect(body.input[0]).toMatchObject({
        role: "user",
        content: [{ type: "input_text", text: "你好" }],
      });
      return new Response([
        "data: {\"type\":\"response.output_item.done\",\"output_index\":0,\"item\":{\"type\":\"message\",\"content\":[{\"type\":\"output_text\",\"text\":\"云端 Codex 回答\"}]}}",
        "data: {\"type\":\"response.completed\",\"response\":{\"output\":[]}}",
        "",
      ].join("\n"), {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const dbHarness = createDbHarness(async (sql, params) => {
      if (sql.includes("FROM mobile_codex_tokens")) {
        expect(params).toEqual(["owner-1"]);
        return {
          first: {
            ownerUid: "owner-1",
            accountName: "codex.json",
            email: "me@example.com",
            accessToken: "access-token",
            refreshToken: "refresh-token",
            accountId: "account-id",
          },
        };
      }
      return {};
    });

    const text = await runMobileAiText(
      createEnv({ DB: dbHarness.db }),
      {
        mode: "codex_oauth",
        apiBaseUrl: "http://127.0.0.1:8317/v1",
        apiKey: "desktop-client-key",
        model: "gpt-5.5",
      },
      [{ role: "user", content: "你好" }],
      { ownerUid: "owner-1" },
    );

    expect(text).toBe("云端 Codex 回答");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("prepares a native Codex OAuth request without sending it from the Worker", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const dbHarness = createDbHarness(async (sql, params) => {
      if (sql.includes("FROM mobile_codex_tokens")) {
        expect(params).toEqual(["owner-1"]);
        return {
          first: {
            ownerUid: "owner-1",
            accountName: "codex.json",
            email: "me@example.com",
            accessToken: "access-token",
            refreshToken: null,
            accountId: "account-id",
          },
        };
      }
      return {};
    });

    const request = await createMobileCodexDirectRequest(
      createEnv({ DB: dbHarness.db }),
      { mode: "codex_oauth", model: "gpt-5-codex" },
      [{ role: "user", content: "浣犲ソ" }],
      "owner-1",
    );

    expect(request.url).toBe("https://chatgpt.com/backend-api/codex/responses");
    expect(request.method).toBe("POST");
    expect(request.headers).toEqual(expect.objectContaining({
      Authorization: "Bearer access-token",
      "Chatgpt-Account-Id": "account-id",
      Originator: "codex-tui",
    }));
    expect(request.headers).not.toHaveProperty("Connection");
    expect(JSON.parse(request.body)).toMatchObject({
      model: "gpt-5.5",
      stream: true,
      input: [{
        role: "user",
        content: [{ type: "input_text", text: "浣犲ソ" }],
      }],
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
