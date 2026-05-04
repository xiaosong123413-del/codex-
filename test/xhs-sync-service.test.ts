import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildExecutableEnv,
  parseDecisionNoteDraft,
  resolveExecutablePath,
  readXhsSyncFailures,
  readXhsSyncTasks,
  runXhsBatch,
  runXhsSingle,
  type XhsFetcher,
} from "../web/server/services/xhs-sync.js";
import { readSourceMediaIndex, sourceMediaId } from "../web/server/services/source-media-index.js";
import { readSourceOcrSidecar } from "../web/server/services/ocr-service.js";
import { readSourceTranscriptSidecar } from "../web/server/services/transcript-service.js";

const roots: string[] = [];

afterEach(() => {
  while (roots.length > 0) {
    fs.rmSync(roots.pop()!, { recursive: true, force: true });
  }
});

describe("xhs sync service", () => {
  it("extracts a single xiaohongshu post into raw clipping markdown", async () => {
    const wikiRoot = makeRoot();
    const fetcher: XhsFetcher = async () => sampleResponse(sampleHtml("64f000000000000001234567"));

    const result = await runXhsSingle(wikiRoot, {
      url: "https://www.xiaohongshu.com/explore/64f000000000000001234567?xsec_token=token",
      now: new Date("2026-04-23T08:00:00.000Z"),
    }, { fetcher, cookiesPath: path.join(wikiRoot, "cookies.json") });

    expect(result.status).toBe("completed");
    expect(result.path).toBe("raw/剪藏/小红书/小红书测试标题.md");
    const raw = fs.readFileSync(path.join(wikiRoot, ...result.path!.split("/")), "utf8");
    expect(fs.existsSync(path.join(wikiRoot, "raw", "剪藏", "小红书", "img", "64f000000000000001234567-1.jpg"))).toBe(true);
    expect(raw).toContain("type: xhs-clipping");
    expect(raw).toContain("title: \"把这是正文 AI转成可验证行动\"");
    expect(raw).toContain("short_title: \"小红书测试标题\"");
    expect(raw).toContain("original_title: \"小红书测试标题\"");
    expect(raw).toContain("source_url: \"https://www.xiaohongshu.com/explore/64f000000000000001234567?xsec_token=token\"");
    expect(raw).toContain("# 把这是正文 AI转成可验证行动");
    expect(raw).toContain("这条笔记的核心不是");
    expect(raw).toContain("> [!tip]- 详情");
    expect(raw).toContain("> [!info]- 笔记属性");
    expect(raw).toContain("![图1](img/64f000000000000001234567-1.jpg)");
    expect(readXhsSyncTasks(wikiRoot).items[0]).toMatchObject({
      status: "completed",
      command: "xhs",
      total: 1,
      completed: 1,
    });
    const mediaIndex = readSourceMediaIndex(wikiRoot);
    const sourceId = sourceMediaId(result.path!);
    expect(mediaIndex.records[sourceId]).toMatchObject({
      path: result.path,
      mediaCount: 1,
      mediaKinds: ["image"],
    });
  });

  it("keeps xiaohongshu clipping successful when Cloudflare OCR writes a sidecar", async () => {
    const wikiRoot = makeRoot();
    const fetcher: XhsFetcher = async (url) => {
      if (url.includes("/explore/")) {
        return sampleResponse(sampleHtml("64f000000000000001234567"));
      }
      if (url.includes("img.example.com")) {
        return new Response("fake-image-binary", {
          status: 200,
          headers: { "content-type": "image/jpeg" },
        });
      }
      throw new Error(`unexpected xhs fetch: ${url}`);
    };
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ text: "图片 OCR 文本。" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    const previousEnv = {
      CLOUDFLARE_WORKER_URL: process.env.CLOUDFLARE_WORKER_URL,
      CLOUDFLARE_REMOTE_TOKEN: process.env.CLOUDFLARE_REMOTE_TOKEN,
      CLOUDFLARE_OCR_MODEL: process.env.CLOUDFLARE_OCR_MODEL,
    };

    process.env.CLOUDFLARE_WORKER_URL = "https://worker.example.com";
    process.env.CLOUDFLARE_REMOTE_TOKEN = "remote-token";
    process.env.CLOUDFLARE_OCR_MODEL = "@cf/test/ocr";
    vi.stubGlobal("fetch", fetchSpy);

    try {
      const result = await runXhsSingle(wikiRoot, {
        url: "https://www.xiaohongshu.com/explore/64f000000000000001234567",
        now: new Date("2026-04-23T08:00:00.000Z"),
      }, { fetcher, cookiesPath: path.join(wikiRoot, "cookies.json"), runtimeRoot: wikiRoot });

      expect(result.status).toBe("completed");
      const sourceId = sourceMediaId(result.path!);
      expect(readSourceOcrSidecar(wikiRoot, sourceId)).toBe("图片 OCR 文本。");
      expect(readSourceMediaIndex(wikiRoot).records[sourceId]?.ocrTextPath).toBe(`.llmwiki/ocr/${sourceId}.txt`);
    } finally {
      vi.unstubAllGlobals();
      restoreEnv(previousEnv);
    }
  });

  it("records a reviewable failure when xiaohongshu extraction cannot read initial state", async () => {
    const wikiRoot = makeRoot();
    const fetcher: XhsFetcher = async () => sampleResponse("<html>login expired</html>");

    const result = await runXhsSingle(wikiRoot, {
      url: "https://www.xiaohongshu.com/explore/64f000000000000001234567",
      now: new Date("2026-04-23T08:00:00.000Z"),
    }, { fetcher, cookiesPath: path.join(wikiRoot, "cookies.json") });

    expect(result.status).toBe("failed");
    expect(result.path).toBeUndefined();
    const failures = readXhsSyncFailures(wikiRoot);
    expect(failures[0]).toMatchObject({
      url: "https://www.xiaohongshu.com/explore/64f000000000000001234567",
      command: "xhs",
    });
    expect(failures[0]?.error).toContain("__INITIAL_STATE__");
  });

  it("transcribes video posts with whisper and writes transcript into markdown", async () => {
    const wikiRoot = makeRoot();
    const fetcher: XhsFetcher = async () => sampleResponse(sampleVideoHtml("64f000000000000001234567"));

    const result = await runXhsSingle(wikiRoot, {
      url: "https://www.xiaohongshu.com/explore/64f000000000000001234567",
      now: new Date("2026-04-23T08:00:00.000Z"),
    }, {
      fetcher,
      cookiesPath: path.join(wikiRoot, "cookies.json"),
      videoTranscriber: async () => "这是视频转录文本。",
    });

    expect(result.status).toBe("completed");
    const raw = fs.readFileSync(path.join(wikiRoot, ...result.path!.split("/")), "utf8");
    expect(fs.existsSync(path.join(wikiRoot, "raw", "剪藏", "小红书", "video", "64f000000000000001234567-1.mp4"))).toBe(true);
    expect(raw).toContain("视频:");
    expect(raw).toContain("![](video/64f000000000000001234567-1.mp4)");
    expect(raw).toContain("视频转录:");
    expect(raw).toContain("这是视频转录文本。");
    const sourceId = sourceMediaId(result.path!);
    expect(readSourceTranscriptSidecar(wikiRoot, sourceId)).toContain("这是视频转录文本。");
    expect(readSourceMediaIndex(wikiRoot).records[sourceId]?.transcriptPath).toBe(
      `.llmwiki/transcripts/${sourceId}.txt`,
    );
  });

  it("prefers Cloudflare transcription for video posts when worker config is present", async () => {
    const wikiRoot = makeRoot();
    const fetcher: XhsFetcher = async (url) => {
      if (url.includes("/explore/")) {
        return sampleResponse(sampleVideoHtml("64f000000000000001234567"));
      }
      if (url.includes("video.example.com")) {
        return new Response("fake-video-binary", {
          status: 200,
          headers: { "content-type": "video/mp4" },
        });
      }
      throw new Error(`unexpected xhs fetch: ${url}`);
    };
    const fetchSpy = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === "https://worker.example.com/transcribe") {
        return new Response(JSON.stringify({ text: "这是云端转录文本。" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`unexpected cloudflare fetch: ${url}`);
    });
    const previousEnv = {
      CLOUDFLARE_WORKER_URL: process.env.CLOUDFLARE_WORKER_URL,
      CLOUDFLARE_REMOTE_TOKEN: process.env.CLOUDFLARE_REMOTE_TOKEN,
      CLOUDFLARE_TRANSCRIBE_MODEL: process.env.CLOUDFLARE_TRANSCRIBE_MODEL,
      LOCALAPPDATA: process.env.LOCALAPPDATA,
      PATH: process.env.PATH,
      Path: process.env.Path,
    };

    process.env.CLOUDFLARE_WORKER_URL = "https://worker.example.com";
    process.env.CLOUDFLARE_REMOTE_TOKEN = "remote-token";
    process.env.CLOUDFLARE_TRANSCRIBE_MODEL = "@cf/openai/whisper";
    process.env.LOCALAPPDATA = "";
    process.env.PATH = "";
    delete process.env.Path;
    vi.stubGlobal("fetch", fetchSpy);

    try {
      const result = await runXhsSingle(wikiRoot, {
        url: "https://www.xiaohongshu.com/explore/64f000000000000001234567",
        now: new Date("2026-04-23T08:00:00.000Z"),
      }, {
        fetcher,
        cookiesPath: path.join(wikiRoot, "cookies.json"),
      });

      expect(result.status).toBe("completed");
      const raw = fs.readFileSync(path.join(wikiRoot, ...result.path!.split("/")), "utf8");
      expect(raw).toContain("视频转录:");
      expect(raw).toContain("这是云端转录文本。");
      const sourceId = sourceMediaId(result.path!);
      expect(readSourceTranscriptSidecar(wikiRoot, sourceId)).toContain("这是云端转录文本。");
      expect(fetchSpy).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
      restoreEnv(previousEnv);
    }
  });

  it("restores the local video when the first save fails but the transcript download succeeds", async () => {
    const wikiRoot = makeRoot();
    let videoRequests = 0;
    const fetcher: XhsFetcher = async (url) => {
      if (url.includes("/explore/")) {
        return sampleResponse(sampleVideoHtml("64f000000000000001234567"));
      }
      if (url.includes("video.example.com")) {
        videoRequests += 1;
        if (videoRequests === 1) {
          throw new Error("terminated");
        }
        return new Response("fake-video-binary", {
          status: 200,
          headers: { "content-type": "video/mp4" },
        });
      }
      throw new Error(`unexpected xhs fetch: ${url}`);
    };
    const fetchSpy = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === "https://worker.example.com/transcribe") {
        return new Response(JSON.stringify({ text: "这是云端转录文本。" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`unexpected cloudflare fetch: ${url}`);
    });
    const previousEnv = {
      CLOUDFLARE_WORKER_URL: process.env.CLOUDFLARE_WORKER_URL,
      CLOUDFLARE_REMOTE_TOKEN: process.env.CLOUDFLARE_REMOTE_TOKEN,
      CLOUDFLARE_TRANSCRIBE_MODEL: process.env.CLOUDFLARE_TRANSCRIBE_MODEL,
    };

    process.env.CLOUDFLARE_WORKER_URL = "https://worker.example.com";
    process.env.CLOUDFLARE_REMOTE_TOKEN = "remote-token";
    process.env.CLOUDFLARE_TRANSCRIBE_MODEL = "@cf/openai/whisper";
    vi.stubGlobal("fetch", fetchSpy);

    try {
      const result = await runXhsSingle(wikiRoot, {
        url: "https://www.xiaohongshu.com/explore/64f000000000000001234567",
        now: new Date("2026-04-23T08:00:00.000Z"),
      }, {
        fetcher,
        cookiesPath: path.join(wikiRoot, "cookies.json"),
      });

      expect(result.status).toBe("completed");
      expect(videoRequests).toBe(2);
      expect(fs.existsSync(path.join(wikiRoot, "raw", "剪藏", "小红书", "video", "64f000000000000001234567-1.mp4"))).toBe(true);
      const raw = fs.readFileSync(path.join(wikiRoot, ...result.path!.split("/")), "utf8");
      expect(raw).toContain("![](video/64f000000000000001234567-1.mp4)");
      expect(raw).not.toContain("视频本地化失败");
    } finally {
      vi.unstubAllGlobals();
      restoreEnv(previousEnv);
    }
  });

  it("formats transcripts before writing markdown and sidecar files", async () => {
    const wikiRoot = makeRoot();
    const fetcher: XhsFetcher = async () => sampleResponse(sampleVideoHtml("64f000000000000001234567"));
    const denseTranscript = "第一个部分讲项目管理第二个部分讲工程协作第三个部分讲共情和推进";
    const formattedTranscript = [
      "第一个部分讲项目管理。",
      "",
      "第二个部分讲工程协作。",
      "",
      "第三个部分讲共情和推进。",
    ].join("\n");

    const result = await runXhsSingle(wikiRoot, {
      url: "https://www.xiaohongshu.com/explore/64f000000000000001234567",
      now: new Date("2026-04-23T08:00:00.000Z"),
    }, {
      fetcher,
      cookiesPath: path.join(wikiRoot, "cookies.json"),
      videoTranscriber: async () => denseTranscript,
      transcriptFormatter: async () => formattedTranscript,
    });

    expect(result.status).toBe("completed");
    const raw = fs.readFileSync(path.join(wikiRoot, ...result.path!.split("/")), "utf8");
    expect(raw).toContain("第一个部分讲项目管理。");
    expect(raw).toContain("第二个部分讲工程协作。");
    expect(raw).toContain("第三个部分讲共情和推进。");
    expect(raw).not.toContain(denseTranscript);
    const sourceId = sourceMediaId(result.path!);
    expect(readSourceTranscriptSidecar(wikiRoot, sourceId)).toBe(formattedTranscript);
  });

  it("batch extracts multiple xiaohongshu urls and tracks extraction progress", async () => {
    const wikiRoot = makeRoot();
    const fetcher: XhsFetcher = async (url) => sampleResponse(sampleHtml(readPostId(url) ?? "64f000000000000001234567"));

    const result = await runXhsBatch(wikiRoot, {
      urls: [
        "https://www.xiaohongshu.com/explore/64f000000000000001234567",
        "https://www.xiaohongshu.com/explore/64f000000000000007654321",
      ],
      now: new Date("2026-04-23T08:00:00.000Z"),
    }, { fetcher, cookiesPath: path.join(wikiRoot, "cookies.json"), delayMs: 0 });

    expect(result.status).toBe("completed");
    expect(result.progress).toEqual({ current: 2, total: 2, percent: 100 });
    expect(result.results).toHaveLength(2);
    expect(readXhsSyncTasks(wikiRoot).items[0]).toMatchObject({
      command: "xhs-batch",
      total: 2,
      completed: 2,
      failed: 0,
    });
  });

  it("writes posts into a configured output directory when provided", async () => {
    const wikiRoot = makeRoot();
    const outputRootParent = fs.mkdtempSync(path.join(os.tmpdir(), "xhs-output-"));
    roots.push(outputRootParent);
    const outputRoot = path.join(outputRootParent, "xiaohongshu");
    fs.mkdirSync(outputRoot, { recursive: true });
    const fetcher: XhsFetcher = async () => sampleResponse(sampleHtml("64f000000000000001234567"));

    const single = await runXhsSingle(wikiRoot, {
      url: "https://www.xiaohongshu.com/explore/64f000000000000001234567",
      now: new Date("2026-04-23T08:00:00.000Z"),
    }, { fetcher, cookiesPath: path.join(wikiRoot, "cookies.json"), outputRoot });

    expect(path.isAbsolute(single.path ?? "")).toBe(true);
    expect(single.path).toContain(outputRoot);
    expect(fs.existsSync(single.path!)).toBe(true);
  });

  it("uses the xhs decision-note formatter with project context when projectRoot is provided", async () => {
    const wikiRoot = makeRoot();
    fs.mkdirSync(path.join(wikiRoot, "docs"), { recursive: true });
    fs.writeFileSync(path.join(wikiRoot, "docs", "current-task.md"), "正在搭建 workflow 存储与调用能力。", "utf8");
    const fetcher: XhsFetcher = async () => sampleResponse(sampleHtml("64f000000000000001234567"));
    let seenContext = "";

    const result = await runXhsSingle(wikiRoot, {
      url: "https://www.xiaohongshu.com/explore/64f000000000000001234567",
      now: new Date("2026-04-23T08:00:00.000Z"),
    }, {
      fetcher,
      cookiesPath: path.join(wikiRoot, "cookies.json"),
      projectRoot: wikiRoot,
      postFormatter: async (input) => {
        seenContext = input.projectContext;
        return {
          insightTitle: "把素材转成工作流判断",
          shortTitle: "工作流判断",
          summaryLines: ["这条内容要服务当前 workflow 目标。"],
          decisionNote: "只有能改变存储或调用路径的内容才进入项目。",
        };
      },
    });

    expect(result.status).toBe("completed");
    expect(seenContext).toContain("workflow 存储与调用能力");
    expect(result.path).toBe("raw/剪藏/小红书/工作流判断.md");
    const raw = fs.readFileSync(path.join(wikiRoot, ...result.path!.split("/")), "utf8");
    expect(raw).toContain("title: \"把素材转成工作流判断\"");
    expect(raw).toContain("只有能改变存储或调用路径的内容才进入项目。");
  });

  it("parses labeled decision-note output when the model omits the outer json object", () => {
    const draft = parseDecisionNoteDraft([
      "insightTitle: 把素材转成工作流判断",
      "shortTitle: 工作流判断",
      "summaryLines:",
      "- 这条内容要服务当前 workflow 目标。",
      "- 保留可执行判断。",
      "decisionNote:",
      "先看它是否改变存储、调用或交付路径。",
      "如果只是复述，就不要入库。",
    ].join("\n"));

    expect(draft).toEqual({
      insightTitle: "把素材转成工作流判断",
      shortTitle: "工作流判断",
      summaryLines: ["这条内容要服务当前 workflow 目标。", "保留可执行判断。"],
      decisionNote: "先看它是否改变存储、调用或交付路径。\n如果只是复述，就不要入库。",
    });
  });

  it("parses json-like decision-note output even when the decision note string is not valid JSON", () => {
    const draft = parseDecisionNoteDraft([
      "{",
      "\"insightTitle\": \"把素材转成工作流判断\",",
      "\"shortTitle\": \"工作流判断\",",
      "\"summaryLines\": [\"先判断是否改变动作\", \"再决定是否入库\"],",
      "\"decisionNote\": \"先判断它是否改变当前项目的动作。",
      "如果只是资料复述，就不要入库。\"",
      "}",
    ].join("\n"));

    expect(draft).toEqual({
      insightTitle: "把素材转成工作流判断",
      shortTitle: "工作流判断",
      summaryLines: ["先判断是否改变动作", "再决定是否入库"],
      decisionNote: "先判断它是否改变当前项目的动作。\n如果只是资料复述，就不要入库。",
    });
  });

  it("resolves ffmpeg from WinGet links when PATH does not expose it", () => {
    const localAppData = fs.mkdtempSync(path.join(os.tmpdir(), "winget-links-"));
    roots.push(localAppData);
    const ffmpegPath = path.join(localAppData, "Microsoft", "WinGet", "Links", "ffmpeg.exe");
    fs.mkdirSync(path.dirname(ffmpegPath), { recursive: true });
    fs.writeFileSync(ffmpegPath, "stub", "utf8");

    expect(resolveExecutablePath("ffmpeg", {
      platform: "win32",
      pathValue: "",
      localAppData,
      pathExt: ".EXE;.CMD",
    })).toBe(ffmpegPath);
  });

  it("prepends the ffmpeg directory to the python child PATH on windows", () => {
    const env = buildExecutableEnv(
      "C:\\tools\\ffmpeg\\bin\\ffmpeg.exe",
      {
        PYTHONUTF8: "1",
        Path: "C:\\Windows\\System32",
      },
      "win32",
    );

    expect(env.Path).toBe("C:\\tools\\ffmpeg\\bin;C:\\Windows\\System32");
    expect(Object.keys(env).filter((key) => key.toLowerCase() === "path")).toEqual(["Path"]);
    expect(env.PYTHONUTF8).toBe("1");
  });
});

function makeRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xhs-sync-"));
  roots.push(root);
  fs.mkdirSync(path.join(root, "raw", "剪藏", "小红书"), { recursive: true });
  fs.writeFileSync(path.join(root, "cookies.json"), JSON.stringify([{ name: "a", value: "b" }]), "utf8");
  return root;
}

function sampleResponse(html: string): Response {
  return new Response(html, {
    status: 200,
    headers: { "content-type": "text/html" },
  });
}

function sampleHtml(postId: string): string {
  const state = {
    note: {
      noteDetailMap: {
        [postId]: {
          note: {
            noteId: postId,
            title: "小红书测试标题",
            desc: "这是正文 #AI[话题]#",
            type: "normal",
            time: 1776902400000,
            user: { nickname: "作者A" },
            imageList: [{ urlDefault: "https://img.example.com/1.jpg" }],
            interactInfo: { likedCount: "12", collectedCount: "3", commentCount: "4" },
            tagList: [{ name: "AI" }],
            ipLocation: "上海",
          },
        },
      },
    },
  };
  return `<html><script>window.__INITIAL_STATE__=${JSON.stringify(state)}</script></html>`;
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
            time: 1776902400000,
            user: { nickname: "作者B" },
            imageList: [],
            video: {
              media: {
                stream: {
                  h264: [{ masterUrl: "https://video.example.com/source.mp4" }],
                },
              },
            },
            interactInfo: { likedCount: "8", collectedCount: "2", commentCount: "1" },
            tagList: [{ name: "工作流" }],
          },
        },
      },
    },
  };
  return `<html><script>window.__INITIAL_STATE__=${JSON.stringify(state)}</script></html>`;
}

function readPostId(url: string): string | null {
  return /[0-9a-f]{24}/i.exec(url)?.[0] ?? null;
}

function restoreEnv(previousEnv: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) {
      delete process.env[key];
      continue;
    }
    process.env[key] = value;
  }
}
