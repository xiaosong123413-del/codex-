import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";

const roots: string[] = [];
const envBackup = new Map<string, string | undefined>();

vi.mock("node:child_process", () => {
  const execFile = Object.assign((
    file: string,
    args: string[],
    options: unknown,
    callback?: (error: Error | null, stdout: string, stderr: string) => void,
  ) => {
    const done = typeof options === "function" ? options : callback;
    if (!done) {
      throw new Error("missing execFile callback");
    }
    if (String(file).includes("py")) {
      done(null, JSON.stringify({ text: "这是本地 Whisper 回退转录。" }), "");
      return;
    }
    done(null, "", "");
  }, {
    [promisify.custom]: async (file: string) => {
      if (String(file).includes("py")) {
        return { stdout: JSON.stringify({ text: "这是本地 Whisper 回退转录。" }), stderr: "" };
      }
      return { stdout: "", stderr: "" };
    },
  });
  return { execFile };
});

vi.mock("../web/server/services/transcript-service.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../web/server/services/transcript-service.js")>();
  return {
    ...actual,
    transcribeFileWithCloudflare: vi.fn(async () => ({
      ok: false as const,
      error: {
        type: "cloudflare-http-error",
        message: "{\"ok\":false,\"error\":\"workers_ai_transcribe_failed\"}",
      },
    })),
  };
});

afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root) fs.rmSync(root, { recursive: true, force: true });
  }
  for (const [key, value] of envBackup.entries()) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  envBackup.clear();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("xhs sync cloudflare fallback", () => {
  it("falls back to local whisper when Cloudflare video transcription fails", async () => {
    const { runXhsSingle } = await import("../web/server/services/xhs-sync.js");
    const wikiRoot = makeRoot();
    backupEnv("CLOUDFLARE_WORKER_URL");
    backupEnv("CLOUDFLARE_REMOTE_TOKEN");
    backupEnv("CLOUDFLARE_TRANSCRIBE_MODEL");
    process.env.CLOUDFLARE_WORKER_URL = "https://worker.example.com";
    process.env.CLOUDFLARE_REMOTE_TOKEN = "remote-token";
    process.env.CLOUDFLARE_TRANSCRIBE_MODEL = "@cf/openai/whisper";

    const fetcher = async (url: string) => {
      if (url.includes("/explore/")) {
        return sampleResponse(sampleVideoHtml("64f000000000000001234567"));
      }
      if (url.includes("video.example.com")) {
        return new Response("fake-video-binary", {
          status: 200,
          headers: { "content-type": "video/mp4" },
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    };

    const result = await runXhsSingle(wikiRoot, {
      url: "https://www.xiaohongshu.com/explore/64f000000000000001234567",
      now: new Date("2026-04-23T08:00:00.000Z"),
    }, {
      fetcher,
      cookiesPath: path.join(wikiRoot, "cookies.json"),
    });
    expect(result.status).toBe("completed");
    const raw = fs.readFileSync(path.join(wikiRoot, ...result.path!.split("/")), "utf8");
    expect(raw).toContain("![](video/64f000000000000001234567-1.mp4)");
    expect(raw).toContain("这是本地 Whisper 回退转录。");
    expect(raw).not.toContain("视频转录失败");
  }, 30_000);
});

function makeRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xhs-cloudflare-fallback-"));
  roots.push(root);
  fs.mkdirSync(path.join(root, "raw", "剪藏", "小红书"), { recursive: true });
  fs.writeFileSync(path.join(root, "cookies.json"), JSON.stringify([{ name: "a", value: "b" }]), "utf8");
  return root;
}

function backupEnv(key: string): void {
  if (!envBackup.has(key)) {
    envBackup.set(key, process.env[key]);
  }
}

function sampleResponse(html: string): Response {
  return new Response(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function sampleVideoHtml(postId: string): string {
  const state = {
    note: {
      noteDetailMap: {
        [postId]: {
          note: {
            noteId: postId,
            title: "小红书视频标题",
            desc: "这是视频正文",
            type: "video",
            time: 1713830400000,
            user: { nickname: "作者A" },
            interactInfo: {
              likedCount: "12",
              collectedCount: "3",
              commentCount: "4",
            },
            video: {
              media: {
                stream: {
                  h264: [{ masterUrl: "https://video.example.com/demo.mp4" }],
                },
              },
            },
            imageList: [],
            tagList: [{ name: "AI" }],
            ipLocation: "上海",
          },
        },
      },
    },
  };
  return `<html><script>window.__INITIAL_STATE__=${JSON.stringify(state)}</script></html>`;
}
