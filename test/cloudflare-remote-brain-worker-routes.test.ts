/**
 * Additional runtime coverage for Remote Brain Worker search and mobile list
 * routes so fallow sees the higher-risk fetch paths exercised directly.
 */

import { describe, expect, it } from "vitest";
import worker, { buildMobileChatReply } from "../cloudflare/remote-brain-worker/src/index.js";
import {
  createAuthorizedRequest,
  createDbHarness,
  createEnv,
  type WorkerEnv,
} from "./cloudflare-remote-brain-worker-test-helpers.js";

describe("Cloudflare Remote Brain Worker routes", () => {
  it("allows mobile app CORS preflight before authorization", async () => {
    const env = createEnv({});

    const response = await worker.fetch(
      new Request("https://remote-brain.example/mobile/entries", {
        method: "OPTIONS",
        headers: {
          Origin: "capacitor://localhost",
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "authorization,content-type",
        },
      }),
      env,
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("capacitor://localhost");
    expect(response.headers.get("access-control-allow-methods")).toContain("POST");
    expect(response.headers.get("access-control-allow-headers")).toContain("authorization");
    expect(response.headers.get("access-control-allow-headers")).toContain("content-type");
  });

  it("fuses keyword and vector search results through the search endpoint", async () => {
    const dbHarness = createDbHarness(async (sql) => {
      if (sql.includes("FROM wiki_pages WHERE content LIKE ? OR title LIKE ?")) {
        return {
          results: [{
            title: "示例页",
            url: "wiki/example.md",
            snippet: "来自关键词命中",
          }],
        };
      }
      return {};
    });
    const env = createEnv({
      DB: dbHarness.db,
      EMBEDDING_MODEL: "@cf/embedding",
      AI: {
        run: async () => ({ data: [[0.1, 0.2, 0.3]] }),
      } as WorkerEnv["AI"],
      VECTORIZE: {
        query: async () => ({
          matches: [{
            id: "wiki/example.md",
            metadata: {
              title: "示例页",
              path: "wiki/example.md",
              excerpt: "来自向量命中",
            },
          }],
        }),
      } as WorkerEnv["VECTORIZE"],
    });

    const response = await worker.fetch(
      createAuthorizedRequest("/search", { query: "示例", limit: 5 }),
      env,
    );
    const payload = await response.json() as {
      results: Array<{ title: string; url: string; snippet: string; sources: string[] }>;
    };

    expect(response.status).toBe(200);
    expect(payload.results).toHaveLength(1);
    expect(payload.results[0]).toMatchObject({
      title: "示例页",
      url: "wiki/example.md",
    });
    expect(payload.results[0]?.sources).toEqual(expect.arrayContaining(["keyword", "vector"]));
  });

  it("returns mobile wiki pages with sync state metadata", async () => {
    const dbHarness = createDbHarness(async (sql) => {
      if (sql.includes("SELECT path, title, content_hash AS version")) {
        return {
          results: [{
            path: "wiki/example.md",
            title: "示例页",
            version: "hash-1",
            publishedAt: "2026-04-25T08:00:00.000Z",
            updatedAt: "2026-04-25T08:05:00.000Z",
            content: "# Example",
          }],
        };
      }
      if (sql.includes("COUNT(*) AS pageCount")) {
        return { first: { pageCount: 1 } };
      }
      if (sql.includes("published_at AS lastWikiPublishAt")) {
        return {
          first: {
            lastWikiPublishAt: "2026-04-25T08:00:00.000Z",
            currentWikiVersion: "publish-1",
            status: "published",
          },
        };
      }
      if (sql.includes("status FROM publish_runs WHERE action = 'publish'")) {
        return { first: { status: "published" } };
      }
      return {};
    });
    const env = createEnv({ DB: dbHarness.db });

    const response = await worker.fetch(
      createAuthorizedRequest("/mobile/wiki/list", {}),
      env,
    );
    const payload = await response.json() as {
      pages: Array<{ path: string; version: string }>;
      syncState: { currentWikiVersion: string; pageCount: number; lastCompileStatus: string };
    };

    expect(response.status).toBe(200);
    expect(payload.pages[0]).toMatchObject({
      path: "wiki/example.md",
      version: "hash-1",
    });
    expect(payload.syncState).toEqual({
      id: "desktop",
      lastWikiPublishAt: "2026-04-25T08:00:00.000Z",
      currentWikiVersion: "publish-1",
      lastCompileStatus: "published",
      pageCount: 1,
    });
  });

  it("filters invalid mobile chat rows when listing chats", async () => {
    const dbHarness = createDbHarness(async (sql) => {
      if (sql.includes("ALTER TABLE mobile_chats ADD COLUMN mode")) {
        return {};
      }
      if (sql.includes("FROM mobile_chats WHERE owner_uid = ?")) {
        return {
          results: [{
            id: "chat-1",
            ownerUid: "owner-1",
            title: "测试对话",
            mode: "hybrid",
            messagesJson: JSON.stringify([
              { id: "m1", role: "user", content: "hello", createdAt: "2026-04-25T00:00:00.000Z" },
              { id: "m2", role: "system", content: "ignore", createdAt: "2026-04-25T00:01:00.000Z" },
            ]),
            sourcesJson: JSON.stringify([
              { id: "s1", type: "web", title: "网页来源", url: "https://example.com" },
              { id: "s2", type: "unknown", title: "Wiki 来源", path: "wiki/example.md" },
            ]),
            createdAt: "2026-04-25T00:00:00.000Z",
            updatedAt: "2026-04-25T00:02:00.000Z",
          }],
        };
      }
      return {};
    });
    const env = createEnv({ DB: dbHarness.db });

    const response = await worker.fetch(
      createAuthorizedRequest("/mobile/chat/list", { ownerUid: "owner-1" }),
      env,
    );
    const payload = await response.json() as {
      chats: Array<{
        messages: Array<{ id: string; role: string }>;
        sources: Array<{ id: string; type: string; path?: string; url?: string }>;
      }>;
    };

    expect(response.status).toBe(200);
    expect(payload.chats[0]?.messages).toEqual([{
      id: "m1",
      role: "user",
      content: "hello",
      createdAt: "2026-04-25T00:00:00.000Z",
    }]);
    expect(payload.chats[0]?.sources).toEqual([
      { id: "s1", type: "web", title: "网页来源", path: undefined, url: "https://example.com", domain: undefined },
      { id: "s2", type: "wiki", title: "Wiki 来源", path: "wiki/example.md", url: undefined, domain: undefined },
    ]);
  });

  it("removes a mobile chat source from the stored chat", async () => {
    const dbHarness = createDbHarness(async (sql) => {
      if (sql.includes("FROM mobile_chats WHERE id = ? AND owner_uid = ?")) {
        return {
          first: {
            id: "chat-1",
            ownerUid: "owner-1",
            title: "测试对话",
            mode: "wiki",
            messagesJson: "[]",
            sourcesJson: JSON.stringify([
              { id: "wiki/a.md", type: "wiki", title: "A", path: "wiki/a.md" },
              { id: "wiki/b.md", type: "wiki", title: "B", path: "wiki/b.md" },
            ]),
            createdAt: "2026-04-25T00:00:00.000Z",
            updatedAt: "2026-04-25T00:02:00.000Z",
          },
        };
      }
      return {};
    });
    const env = createEnv({ DB: dbHarness.db });

    const response = await worker.fetch(
      createAuthorizedRequest("/mobile/chat/source/remove", {
        ownerUid: "owner-1",
        chatId: "chat-1",
        sourceId: "wiki/a.md",
      }),
      env,
    );
    const payload = await response.json() as {
      chat: { sources: Array<{ id: string }> };
    };

    expect(response.status).toBe(200);
    expect(payload.chat.sources).toEqual([{ id: "wiki/b.md", type: "wiki", title: "B", path: "wiki/b.md" }]);
    const saveCall = dbHarness.calls.find((call) => call.sql.includes("INSERT INTO mobile_chats"));
    expect(String(saveCall?.params[5])).not.toContain("wiki/a.md");
  });

  it("uses manually selected wiki pages when sending mobile chat messages", async () => {
    const dbHarness = createDbHarness(async (sql) => {
      if (sql.includes("ALTER TABLE mobile_chats ADD COLUMN mode")) {
        return {};
      }
      if (sql.includes("FROM wiki_pages WHERE path IN")) {
        return {
          results: [{
            path: "wiki/manual.md",
            title: "手动页面",
            content: "手动选择的 Wiki 内容",
          }],
        };
      }
      if (sql.includes("FROM wiki_pages WHERE content LIKE")) {
        return {
          results: [{
            path: "wiki/search.md",
            title: "搜索页面",
            content: "自动搜索的 Wiki 内容",
          }],
        };
      }
      return {};
    });
    const env = createEnv({
      DB: dbHarness.db,
      LLM_MODEL: "@cf/fake-model",
      AI: {
        run: async () => ({ response: "回答" }),
      } as WorkerEnv["AI"],
    });

    const response = await worker.fetch(
      createAuthorizedRequest("/mobile/chat/send", {
        ownerUid: "owner-1",
        message: "问题",
        mode: "wiki",
        selectedWikiPaths: ["wiki/manual.md"],
      }),
      env,
    );
    const payload = await response.json() as {
      chat: { sources: Array<{ path: string; title: string }> };
    };

    expect(response.status).toBe(200);
    expect(payload.chat.sources.map((source) => source.path)).toEqual(["wiki/manual.md", "wiki/search.md"]);
    expect(payload.chat.sources[0]?.title).toBe("手动页面");
  });

  it("saves and lists mobile task schedule items", async () => {
    let rows: Array<Record<string, unknown>> = [];
    const reviewSettings = new Map<string, boolean>();
    // fallow-ignore-next-line complexity
    const dbHarness = createDbHarness(async (sql, params) => {
      if (sql.includes("CREATE TABLE IF NOT EXISTS mobile_task_schedule")) {
        return {};
      }
      if (sql.includes("CREATE TABLE IF NOT EXISTS mobile_task_review_settings")) {
        return {};
      }
      if (sql.includes("ALTER TABLE mobile_task_schedule ADD COLUMN")) {
        return {};
      }
      if (sql.includes("INSERT INTO mobile_task_review_settings")) {
        reviewSettings.set(String(params[0]), params[1] === 1);
        return {};
      }
      if (sql.includes("FROM mobile_task_review_settings WHERE owner_uid = ?")) {
        return { first: { enabled: reviewSettings.get(String(params[0])) ? 1 : 0 } };
      }
      if (sql.includes("DELETE FROM mobile_task_schedule")) {
        rows = [];
        return {};
      }
      if (sql.includes("INSERT INTO mobile_task_schedule")) {
        rows.push({
          id: params[0],
          ownerUid: params[1],
          title: params[2],
          kind: params[3],
          startTime: params[4],
          endTime: params[5],
          priority: params[6],
          done: params[7],
          note: params[8],
          source: params[9],
          updatedAt: params[10],
        });
        return {};
      }
      if (sql.includes("FROM mobile_task_schedule")) {
        return { results: rows };
      }
      return {};
    });
    const env = createEnv({ DB: dbHarness.db });

    const saveResponse = await worker.fetch(
      createAuthorizedRequest("/mobile/tasks/save", {
        ownerUid: "owner-1",
        items: [{ id: "task-1", title: "写今日总结", kind: "done", startTime: "19:30", priority: "high", done: true }],
      }),
      env,
    );
    const savePayload = await saveResponse.json() as { items: Array<{ id: string; kind: string; done: boolean }> };
    expect(saveResponse.status).toBe(200);
    expect(savePayload.items[0]).toMatchObject({ id: "task-1", kind: "done", done: true });

    const settingResponse = await worker.fetch(
      createAuthorizedRequest("/mobile/tasks/review-setting", { ownerUid: "owner-1", enabled: true }),
      env,
    );
    expect(settingResponse.status).toBe(200);

    const listResponse = await worker.fetch(createAuthorizedRequest("/mobile/tasks/list", { ownerUid: "owner-1" }), env);
    const listPayload = await listResponse.json() as { items: Array<{ title: string; startTime: string }>; reviewEnabled: boolean };
    expect(listResponse.status).toBe(200);
    expect(listPayload.reviewEnabled).toBe(true);
    expect(listPayload.items).toEqual([expect.objectContaining({ title: "写今日总结", startTime: "19:30" })]);
  });

  it("saves and reads shared mobile documents", async () => {
    const rows = new Map<string, Record<string, unknown>>();
    const dbHarness = createDbHarness(async (sql, params) => {
      if (sql.includes("CREATE TABLE IF NOT EXISTS mobile_documents")) return {};
      if (sql.includes("INSERT INTO mobile_documents")) {
        rows.set(String(params[0]), {
          path: params[0],
          title: params[1],
          raw: params[2],
          updatedAt: params[3],
        });
        return {};
      }
      if (sql.includes("FROM mobile_documents WHERE path = ?")) {
        return { first: rows.get(String(params[0])) ?? null };
      }
      return {};
    });
    const env = createEnv({ DB: dbHarness.db });

    const saveResponse = await worker.fetch(
      createAuthorizedRequest("/mobile/documents/save", {
        path: "wiki/journal-twelve-questions.md",
        title: "十二个问题",
        raw: "# 十二个问题\n\n- 今天最重要的问题是什么？",
      }),
      env,
    );
    expect(saveResponse.status).toBe(200);

    const readResponse = await worker.fetch(
      createAuthorizedRequest("/mobile/documents/get", { path: "wiki/journal-twelve-questions.md" }),
      env,
    );
    const payload = await readResponse.json() as { document: { title: string; raw: string } };
    expect(payload.document.title).toBe("十二个问题");
    expect(payload.document.raw).toContain("今天最重要的问题");
  });

  it("reads nested AI response text when generating mobile chat replies", async () => {
    const env = createEnv({
      LLM_MODEL: "@cf/fake-model",
      AI: {
        run: async () => ({
          result: {
            generated_text: "嵌套回答",
          },
        }),
      } as WorkerEnv["AI"],
    });

    const reply = await buildMobileChatReply(
      env,
      "wiki",
      "问一个问题",
      [],
      [{ path: "wiki/example.md", title: "示例页", content: "Wiki 内容" }],
      { ok: true, results: [] },
    );

    expect(reply).toEqual({
      text: "嵌套回答",
      sources: [{ id: "wiki/example.md", type: "wiki", title: "示例页", path: "wiki/example.md" }],
    });
  });
});
