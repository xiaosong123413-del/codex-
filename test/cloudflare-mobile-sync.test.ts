import { describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildWikiPageRecords,
  createCloudflareWikiPublishScheduler,
  publishWikiToCloudflare,
  syncDesktopFlashDiariesToCloudflare,
  syncMobileEntriesToRawFromCloudflare,
  syncMobileEntriesToRaw,
} from "../scripts/sync-compile/cloudflare-mobile-sync.mjs";

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "llmwiki-cloudflare-"));
}

function fakeDb(entries: Array<{ id: string; data: Record<string, unknown> }>) {
  const updates: Array<{ id: string; patch: Record<string, unknown> }> = [];
  return {
    updates,
    collection(name: string) {
      expect(name).toBe("mobile_entries");
      return {
        where(field: string, op: string, value: string) {
          expect([field, op, value]).toEqual(["status", "==", "new"]);
          return {
            async get() {
              return {
                docs: entries.map((entry) => ({
                  id: entry.id,
                  data: () => entry.data,
                  ref: {
                    update: async (patch: Record<string, unknown>) => {
                      updates.push({ id: entry.id, patch });
                    },
                  },
                })),
              };
            },
          };
        },
      };
    },
  };
}

describe("cloudflare mobile sync", () => {
  test("runs an immediate reconcile publish when the watcher starts", async () => {
    const publishWiki = vi.fn().mockResolvedValue({ skipped: false });
    const scheduler = createCloudflareWikiPublishScheduler({ publishWiki, debounceMs: 800 });

    await scheduler.reconcileNow();

    expect(publishWiki).toHaveBeenCalledTimes(1);
  });

  test("debounces rapid wiki change events into one publish run", async () => {
    vi.useFakeTimers();
    const publishWiki = vi.fn().mockResolvedValue({ skipped: false });
    const scheduler = createCloudflareWikiPublishScheduler({ publishWiki, debounceMs: 800 });

    scheduler.scheduleChange("wiki/index.md");
    scheduler.scheduleChange("wiki/concepts/redis.md");

    await vi.advanceTimersByTimeAsync(799);
    expect(publishWiki).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(publishWiki).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  test("queues one more wiki publish when a change lands during an active publish", async () => {
    vi.useFakeTimers();
    let resolveFirstPublish!: () => void;
    const firstPublish = new Promise<void>((resolve) => {
      resolveFirstPublish = resolve;
    });
    const publishWiki = vi
      .fn()
      .mockImplementationOnce(() => firstPublish)
      .mockResolvedValueOnce({ skipped: false });
    const scheduler = createCloudflareWikiPublishScheduler({ publishWiki, debounceMs: 800 });

    scheduler.scheduleChange("wiki/index.md");
    await vi.advanceTimersByTimeAsync(800);
    expect(publishWiki).toHaveBeenCalledTimes(1);

    scheduler.scheduleChange("wiki/index.md");
    await vi.advanceTimersByTimeAsync(800);
    expect(publishWiki).toHaveBeenCalledTimes(1);

    resolveFirstPublish();
    await Promise.resolve();
    expect(publishWiki).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });

  test("publishes wiki pages with publishVersion and records the local publish state", async () => {
    const projectRoot = tempDir();
    const vaultRoot = tempDir();
    fs.mkdirSync(path.join(vaultRoot, "wiki"), { recursive: true });
    fs.writeFileSync(path.join(vaultRoot, "wiki", "index.md"), "# Index\n\nHello Cloudflare.\n", "utf8");

    vi.stubEnv("CLOUDFLARE_WORKER_URL", "https://worker.example.com");
    vi.stubEnv("CLOUDFLARE_REMOTE_TOKEN", "test-token");

    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body ?? "{}"));
      calls.push({ url, body });
      return new Response(JSON.stringify({ ok: true, pageCount: 1, vectorUpserted: 0, vectorErrors: 0 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const result = await publishWikiToCloudflare({
      projectRoot,
      vaultRoot,
      version: "2026-04-25T12:00:00.000Z",
    });

    expect(result).toEqual(expect.objectContaining({
      publishedCount: 1,
      skipped: false,
      publishVersion: expect.any(String),
    }));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual(expect.objectContaining({
      url: "https://worker.example.com/publish",
      body: expect.objectContaining({
        action: "publish",
        wikiRoot: path.basename(vaultRoot),
        publishVersion: expect.any(String),
      }),
    }));

    const publishState = JSON.parse(
      fs.readFileSync(path.join(vaultRoot, ".llmwiki", "cloudflare-publish-state.json"), "utf8"),
    ) as { publishVersion: string; publishedAt: string };
    expect(publishState.publishVersion).toBe(String(calls[0]?.body.publishVersion ?? ""));
    expect(publishState.publishedAt).toBe("2026-04-25T12:00:00.000Z");

    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  test("uses account session auth and user routes for public sync", async () => {
    const projectRoot = tempDir();
    const vaultRoot = tempDir();
    fs.mkdirSync(path.join(vaultRoot, "wiki"), { recursive: true });
    fs.writeFileSync(path.join(vaultRoot, "wiki", "index.md"), "# Index\n\nAccount scoped.\n", "utf8");

    vi.stubEnv("CLOUDFLARE_WORKER_URL", "https://worker.example.com");
    vi.stubEnv("CLOUDFLARE_ACCOUNT_SESSION_TOKEN", "session-token");
    vi.stubEnv("CLOUDFLARE_WORKSPACE_ID", "workspace-one");

    const calls: Array<{ url: string; authorization: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push({
        url,
        authorization: String((init.headers as Record<string, string>).Authorization ?? ""),
        body: JSON.parse(String(init.body ?? "{}")),
      });
      return new Response(JSON.stringify({ ok: true, pageCount: 1 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const result = await publishWikiToCloudflare({
      projectRoot,
      vaultRoot,
      version: "2026-04-29T12:00:00.000Z",
    });

    expect(result).toEqual(expect.objectContaining({ publishedCount: 1, skipped: false }));
    expect(calls[0]).toEqual(expect.objectContaining({
      url: "https://worker.example.com/user/publish",
      authorization: "Bearer session-token",
      body: expect.objectContaining({ workspaceId: "workspace-one" }),
    }));

    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  test("skips Cloudflare publish when the local wiki manifest has not changed", async () => {
    const projectRoot = tempDir();
    const vaultRoot = tempDir();
    fs.mkdirSync(path.join(vaultRoot, "wiki"), { recursive: true });
    fs.writeFileSync(path.join(vaultRoot, "wiki", "index.md"), "# Index\n\nHello Cloudflare.\n", "utf8");

    vi.stubEnv("CLOUDFLARE_WORKER_URL", "https://worker.example.com");
    vi.stubEnv("CLOUDFLARE_REMOTE_TOKEN", "test-token");

    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, pageCount: 1, vectorUpserted: 0, vectorErrors: 0 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchImpl);

    const first = await publishWikiToCloudflare({
      projectRoot,
      vaultRoot,
      version: "2026-04-25T12:00:00.000Z",
    });
    const second = await publishWikiToCloudflare({
      projectRoot,
      vaultRoot,
      version: "2026-04-25T12:01:00.000Z",
    });

    expect(first.skipped).toBe(false);
    expect(second).toEqual(expect.objectContaining({
      publishedCount: 0,
      skipped: true,
      publishVersion: first.publishVersion,
    }));
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  test("pushes desktop flash diary files to Cloudflare mobile entries", async () => {
    const vaultRoot = tempDir();
    fs.mkdirSync(path.join(vaultRoot, "raw", "闪念日记"), { recursive: true });
    fs.writeFileSync(
      path.join(vaultRoot, "raw", "闪念日记", "2026-04-21.md"),
      [
        "# 2026-04-21 闪念日记",
        "",
        "## 21:07:42",
        "",
        "第一条电脑日记。",
        "",
        "---",
        "",
        "## 21:20",
        "",
        "第二条电脑日记。",
        "",
      ].join("\n"),
      "utf8",
    );

    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body ?? "{}")) });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const result = await syncDesktopFlashDiariesToCloudflare({
      vaultRoot,
      client: {
        workerUrl: "https://worker.example.com",
        remoteToken: "test-token",
      },
      now: "2026-04-27T08:00:00.000Z",
    });

    expect(result).toEqual({ pushedCount: 2, failedCount: 0 });
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual(expect.objectContaining({
      url: "https://worker.example.com/mobile/entries",
      body: expect.objectContaining({
        ownerUid: "",
        type: "flash_diary",
        title: "第一条电脑日记。",
        text: "第一条电脑日记。",
        targetDate: "2026-04-21",
        createdAt: "2026-04-21T21:07:42+08:00",
        status: "synced",
        channel: "desktop-flash-diary",
        sourceName: "电脑端日记",
      }),
    }));
    expect(calls[1].body).toEqual(expect.objectContaining({
      createdAt: "2026-04-21T21:20:00+08:00",
      text: "第二条电脑日记。",
    }));

    vi.unstubAllGlobals();
  });

  test("syncs desktop flash diaries even when wiki publish is skipped", async () => {
    const projectRoot = tempDir();
    const vaultRoot = tempDir();
    fs.mkdirSync(path.join(vaultRoot, "wiki"), { recursive: true });
    fs.writeFileSync(path.join(vaultRoot, "wiki", "index.md"), "# Index\n\nHello Cloudflare.\n", "utf8");

    vi.stubEnv("CLOUDFLARE_WORKER_URL", "https://worker.example.com");
    vi.stubEnv("CLOUDFLARE_REMOTE_TOKEN", "test-token");

    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body ?? "{}")) });
      return new Response(JSON.stringify({ ok: true, pageCount: 1, vectorUpserted: 0, vectorErrors: 0 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const first = await publishWikiToCloudflare({
      projectRoot,
      vaultRoot,
      version: "2026-04-25T12:00:00.000Z",
    });

    fs.mkdirSync(path.join(vaultRoot, "raw", "闪念日记"), { recursive: true });
    fs.writeFileSync(
      path.join(vaultRoot, "raw", "闪念日记", "2026-04-22.md"),
      "# 2026-04-22 闪念日记\n\n## 13:46:53\n\n电脑端新增。\n",
      "utf8",
    );

    const second = await publishWikiToCloudflare({
      projectRoot,
      vaultRoot,
      version: "2026-04-25T12:01:00.000Z",
    });

    expect(first.skipped).toBe(false);
    expect(second).toEqual(expect.objectContaining({
      publishedCount: 0,
      skipped: true,
      mobileDiaryPushed: 1,
      mobileDiaryFailed: 0,
    }));
    expect(calls.map((call) => new URL(call.url).pathname)).toEqual(["/publish", "/mobile/entries"]);

    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  test("publishes wiki from runtime root while syncing desktop diaries from source root", async () => {
    const projectRoot = tempDir();
    const runtimeRoot = tempDir();
    const sourceRoot = tempDir();
    fs.mkdirSync(path.join(runtimeRoot, "wiki"), { recursive: true });
    fs.mkdirSync(path.join(sourceRoot, "raw", "闪念日记"), { recursive: true });
    fs.writeFileSync(path.join(runtimeRoot, "wiki", "index.md"), "# Index\n\nRuntime wiki.\n", "utf8");
    fs.writeFileSync(
      path.join(sourceRoot, "raw", "闪念日记", "2026-04-19.md"),
      "# 2026-04-19 闪念日记\n\n## 12:15:38\n\n源仓库日记。\n",
      "utf8",
    );

    vi.stubEnv("CLOUDFLARE_WORKER_URL", "https://worker.example.com");
    vi.stubEnv("CLOUDFLARE_REMOTE_TOKEN", "test-token");

    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body ?? "{}")) });
      return new Response(JSON.stringify({ ok: true, pageCount: 1, vectorUpserted: 0, vectorErrors: 0 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const result = await publishWikiToCloudflare({
      projectRoot,
      vaultRoot: runtimeRoot,
      mobileDiaryRoot: sourceRoot,
      version: "2026-04-27T08:00:00.000Z",
    });

    expect(result).toEqual(expect.objectContaining({
      publishedCount: 1,
      mobileDiaryPushed: 1,
      mobileDiaryFailed: 0,
    }));
    expect(calls.map((call) => new URL(call.url).pathname)).toEqual(["/publish", "/mobile/entries"]);
    expect(calls[1].body).toEqual(expect.objectContaining({
      text: "源仓库日记。",
      targetDate: "2026-04-19",
    }));

    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  test("pulls mobile entries into local raw queues and marks them synced", async () => {
    const vaultRoot = tempDir();
    const db = fakeDb([
      {
        id: "flash-1",
        data: {
          type: "flash_diary",
          title: "午后想法",
          text: "今天想到一个产品入口。",
          targetDate: "2026-04-19",
          createdAt: "2026-04-19T12:03:00.000Z",
          mediaFiles: ["https://example.com/a.png"],
        },
      },
      {
        id: "clip-1",
        data: {
          type: "clipping",
          title: "LLM Wiki 文章",
          text: "网页剪藏内容",
          sourceUrl: "https://example.com/wiki",
          sourceName: "Example",
          channel: "web",
          createdAt: "2026-04-19T12:04:00.000Z",
        },
      },
      {
        id: "inbox-1",
        data: {
          type: "inbox",
          title: "需要亲自处理",
          text: "这条先放 inbox。",
          createdAt: "2026-04-19T12:05:00.000Z",
        },
      },
    ]);

    vi.stubGlobal("fetch", async () =>
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "content-type": "image/png" },
      })
    );

    const result = await syncMobileEntriesToRaw({ vaultRoot, db, now: "2026-04-19T12:10:00.000Z" });

    expect(result).toEqual({ pulledCount: 3, failedCount: 0 });
    expect(fs.readFileSync(path.join(vaultRoot, "raw", "闪念日记", "2026-04-19.md"), "utf8"))
      .toContain("今天想到一个产品入口。");
    expect(fs.readFileSync(path.join(vaultRoot, "raw", "剪藏", "LLM Wiki 文章.md"), "utf8"))
      .toContain("source_url: https://example.com/wiki");
    expect(fs.readFileSync(path.join(vaultRoot, "inbox", "需要亲自处理.md"), "utf8"))
      .toContain("这条先放 inbox。");
    expect(db.updates).toHaveLength(3);
    expect(db.updates.every((item) => item.patch.status === "synced")).toBe(true);
    vi.unstubAllGlobals();
  });

  test("pulls Cloudflare mobile entries and marks them synced", async () => {
    const vaultRoot = tempDir();
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body ?? "{}"));
      calls.push({ url, body });
      if (url.endsWith("/mobile/entries/pending")) {
        return new Response(JSON.stringify({
          ok: true,
          entries: [
            {
              id: "flash-1",
              type: "flash_diary",
              title: "午后想法",
              text: "今天想到一个产品入口。",
              targetDate: "2026-04-19",
              createdAt: "2026-04-19T12:03:00.000Z",
              mediaFiles: [],
            },
          ],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
    });

    const result = await syncMobileEntriesToRawFromCloudflare({
      vaultRoot,
      client: {
        workerUrl: "https://worker.example.com",
        remoteToken: "test-token",
      },
      now: "2026-04-19T12:10:00.000Z",
    });

    expect(result).toEqual({ pulledCount: 1, failedCount: 0 });
    expect(fs.readFileSync(path.join(vaultRoot, "raw", "闪念日记", "2026-04-19.md"), "utf8"))
      .toContain("今天想到一个产品入口。");
    expect(calls).toContainEqual(expect.objectContaining({
      url: "https://worker.example.com/mobile/entries/status",
      body: expect.objectContaining({ id: "flash-1", status: "synced" }),
    }));
    vi.unstubAllGlobals();
  });

  test("upserts duplicate Cloudflare diary entries and keeps the richer media block", async () => {
    const vaultRoot = tempDir();
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body ?? "{}"));
      calls.push({ url, body });
      if (url.endsWith("/mobile/entries/pending")) {
        return new Response(JSON.stringify({
          ok: true,
          entries: [
            {
              id: "early",
              type: "flash_diary",
              title: "早上记录",
              text: "今天继续推进。",
              targetDate: "2026-04-28",
              createdAt: "2026-04-28T06:45:00+08:00",
              mediaFiles: [],
            },
            {
              id: "plain",
              type: "flash_diary",
              title: "开心记录",
              text: "开心❤️爽，mimo百万亿token轻松拿下",
              targetDate: "2026-04-28",
              createdAt: "2026-04-28T14:59:00+08:00",
              mediaFiles: [],
            },
            {
              id: "with-media",
              type: "flash_diary",
              title: "开心记录",
              text: "开心❤️爽，mimo百万亿token轻松拿下",
              targetDate: "2026-04-28",
              createdAt: "2026-04-28T14:59:00+08:00",
              mediaFiles: ["mobile-image.jpg"],
            },
          ],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
    });

    const result = await syncMobileEntriesToRawFromCloudflare({
      vaultRoot,
      client: {
        workerUrl: "https://worker.example.com",
        remoteToken: "test-token",
      },
      now: "2026-04-28T15:10:00.000Z",
    });

    const diary = fs.readFileSync(path.join(vaultRoot, "raw", "闪念日记", "2026-04-28.md"), "utf8");
    expect(result).toEqual({ pulledCount: 3, failedCount: 0 });
    expect((diary.match(/开心❤️爽，mimo百万亿token轻松拿下/g) ?? [])).toHaveLength(1);
    expect(diary).toContain("### 附件\n![图片附件](mobile-image.jpg)");
    expect(diary).not.toMatch(/\.(?:jpg|png|webp|gif)\)##\s+\d{2}:\d{2}/);
    expect(calls.filter((call) => call.url.endsWith("/mobile/entries/status"))).toHaveLength(3);
    vi.unstubAllGlobals();
  });

  test("sorts mobile and desktop diary blocks together by time", async () => {
    const vaultRoot = tempDir();
    fs.mkdirSync(path.join(vaultRoot, "raw", "闪念日记"), { recursive: true });
    fs.writeFileSync(
      path.join(vaultRoot, "raw", "闪念日记", "2026-04-28.md"),
      [
        "# 2026-04-28 闪念日记",
        "",
        "## 23:25:42",
        "",
        "电脑端深夜记录。",
        "",
        "## [§](#15%3A01%3A14) 15:01:14",
        "",
        "电脑端下午记录。",
        "",
        "## [§](#02%3A47) 02:47",
        "",
        "电脑端凌晨记录。",
        "",
      ].join("\n"),
      "utf8",
    );
    vi.stubGlobal("fetch", async (url: string) => {
      if (url.endsWith("/mobile/entries/pending")) {
        return new Response(JSON.stringify({
          ok: true,
          entries: [
            {
              id: "mobile-1459",
              type: "flash_diary",
              title: "手机下午记录",
              text: "手机端 14:59 记录。",
              targetDate: "2026-04-28",
              createdAt: "2026-04-28T14:59:00+08:00",
              mediaFiles: [],
            },
          ],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
    });

    await syncMobileEntriesToRawFromCloudflare({
      vaultRoot,
      client: {
        workerUrl: "https://worker.example.com",
        remoteToken: "test-token",
      },
      now: "2026-04-28T15:10:00.000Z",
    });

    const diary = fs.readFileSync(path.join(vaultRoot, "raw", "闪念日记", "2026-04-28.md"), "utf8");
    const times = [...diary.matchAll(/^##\s+.*?(\d{2}:\d{2}(?::\d{2})?)/gm)].map((match) => match[1]);
    expect(times).toEqual(["23:25:42", "15:01:14", "14:59:00", "02:47"]);
    vi.unstubAllGlobals();
  });

  test("writes UTC mobile diary entries as separate China-time blocks", async () => {
    const vaultRoot = tempDir();
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      if (url.endsWith("/mobile/entries/pending")) {
        return new Response(JSON.stringify({
          ok: true,
          entries: [
            {
              id: "flash-utc-1",
              type: "flash_diary",
              title: "今天记录",
              text: "洗完澡，心情很好。## 08:34\n继续记录第二段。\n## 08:30\n记录第三段。",
              targetDate: "2026-04-29",
              createdAt: "2026-04-29T09:10:00.000Z",
              mediaFiles: [],
            },
          ],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
    });

    const result = await syncMobileEntriesToRawFromCloudflare({
      vaultRoot,
      client: {
        workerUrl: "https://worker.example.com",
        remoteToken: "test-token",
      },
      now: "2026-04-29T09:21:00.000Z",
    });

    const diary = fs.readFileSync(path.join(vaultRoot, "raw", "闪念日记", "2026-04-29.md"), "utf8");
    expect(result).toEqual({ pulledCount: 1, failedCount: 0 });
    expect(diary).toContain("## 17:10:00\n洗完澡，心情很好。");
    expect(diary).toContain("## 16:34:00\n继续记录第二段。");
    expect(diary).toContain("## 16:30:00\n记录第三段。");
    expect(diary.indexOf("## 17:10:00")).toBeLessThan(diary.indexOf("## 16:34:00"));
    expect(diary.indexOf("## 16:34:00")).toBeLessThan(diary.indexOf("## 16:30:00"));
    vi.unstubAllGlobals();
  });

  test("builds read-only wiki records with links and backlinks", async () => {
    const vaultRoot = tempDir();
    fs.mkdirSync(path.join(vaultRoot, "wiki", "concepts"), { recursive: true });
    fs.writeFileSync(
      path.join(vaultRoot, "wiki", "index.md"),
      "# Index\n\nSee [[Redis]] and [[Workflow]].\n",
      "utf8",
    );
    fs.writeFileSync(
      path.join(vaultRoot, "wiki", "concepts", "redis.md"),
      "---\ntitle: Redis\naliases:\n  - cache\n---\n# Redis\n\nBack to [[Index]].\n",
      "utf8",
    );

    const records = await buildWikiPageRecords(vaultRoot, "v1");
    const index = records.find((record) => record.path === "index.md")!;
    const redis = records.find((record) => record.path === "concepts/redis.md")!;

    expect(index.pageType).toBe("index");
    expect(index.links).toEqual(["Redis", "Workflow"]);
    expect(redis.title).toBe("Redis");
    expect(redis.aliases).toEqual(["cache"]);
    expect(redis.backlinks).toEqual(["index.md"]);
    expect(redis.version).toBe("v1");
  });
});
