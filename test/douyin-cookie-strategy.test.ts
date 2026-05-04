import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";

const roots: string[] = [];
const execCalls: Array<{ file: string; args: string[] }> = [];
const failingBrowsers = new Set<string>();
let cookieJarContent = "";

vi.mock("node:child_process", () => {
  const invoke = (
    file: string,
    args: string[],
  ): { stdout: string; stderr: string } => {
    execCalls.push({ file, args: [...args] });
    const browserIndex = args.indexOf("--cookies-from-browser");
    if (browserIndex >= 0 && failingBrowsers.has(args[browserIndex + 1] ?? "")) {
      throw new Error(`missing ${args[browserIndex + 1]} cookies`);
    }
    const cookieIndex = args.indexOf("--cookies");
    if (cookieIndex >= 0 && args[cookieIndex + 1]) {
      cookieJarContent = fs.readFileSync(args[cookieIndex + 1]!, "utf8");
    }
    if (args.includes("--dump-single-json")) {
      return {
        stdout: JSON.stringify({
          id: "7632093728575891953",
          title: "抖音测试视频",
          description: "测试文案",
          uploader: "测试作者",
          webpage_url: "https://www.douyin.com/video/7632093728575891953",
        }),
        stderr: "",
      };
    }
    const outputIndex = args.indexOf("-o");
    if (outputIndex >= 0 && args[outputIndex + 1]) {
      const outputDir = path.dirname(args[outputIndex + 1]!);
      fs.mkdirSync(outputDir, { recursive: true });
      fs.writeFileSync(path.join(outputDir, "mock-video.mp4"), "video", "utf8");
    }
    return { stdout: "", stderr: "" };
  };
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
    const result = invoke(file, args);
    done(null, result.stdout, result.stderr);
  }, {
    [promisify.custom]: async (file: string, args: string[]) => invoke(file, args),
  });
  return { execFile };
});

vi.mock("../web/server/services/yt-dlp.js", () => ({
  detectYtDlp: vi.fn(async () => ({
    installed: true,
    source: "project",
    path: "D:/Desktop/llm-wiki-compiler-main/tools/yt-dlp.exe",
    version: "2026.04.24",
  })),
}));

afterEach(() => {
  execCalls.length = 0;
  failingBrowsers.clear();
  cookieJarContent = "";
  while (roots.length > 0) {
    const root = roots.pop();
    if (root) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
  vi.resetModules();
});

describe("douyin cookie strategy", () => {
  it("passes saved douyin cookies to yt-dlp via a cookie jar file instead of a Cookie header", async () => {
    const { createDouyinCollector } = await import("../web/server/services/douyin-sync.js");
    const root = makeRoot();
    const outputDir = path.join(root, "raw", "剪藏", "抖音");
    const cookiePath = path.join(root, ".llmwiki", "douyin-cookie.txt");
    fs.mkdirSync(path.dirname(cookiePath), { recursive: true });
    fs.writeFileSync(cookiePath, "sessionid_ss=abc; uid_tt=1; douyin.com; passport_csrf_token=xyz\n", "utf8");

    const collector = createDouyinCollector(root, { cookieBrowsers: [] });
    const result = await collector.collect({
      url: "https://v.douyin.com/o_-rwXmFmMY/",
      outputDir,
      quality: "720",
      projectRoot: root,
    });

    expect(result.video?.storedPath).toBe("video/mock-video.mp4");
    expect(execCalls.some((call) => call.args.includes("--cookies"))).toBe(true);
    expect(execCalls.some((call) => call.args.join(" ").includes("Cookie: sessionid_ss=abc"))).toBe(false);
    expect(cookieJarContent).toContain("# Netscape HTTP Cookie File");
    expect(cookieJarContent).toContain(".douyin.com\tTRUE\t/\tTRUE\t2147483647\tsessionid_ss\tabc");
    expect(cookieJarContent).toContain(".douyin.com\tTRUE\t/\tTRUE\t2147483647\tuid_tt\t1");
    expect(cookieJarContent).toContain(".douyin.com\tTRUE\t/\tTRUE\t2147483647\tpassport_csrf_token\txyz");
    expect(cookieJarContent).not.toContain("\tdouyin.com\t");
  }, 30_000);

  it("reports every failed browser cookie strategy instead of only the last one", async () => {
    const { createDouyinCollector } = await import("../web/server/services/douyin-sync.js");
    const root = makeRoot();
    const outputDir = path.join(root, "raw", "剪藏", "抖音");
    failingBrowsers.add("chrome");
    failingBrowsers.add("edge");
    failingBrowsers.add("firefox");

    const collector = createDouyinCollector(root);
    await expect(collector.collect({
      url: "https://v.douyin.com/WN-2CwOCEg0/",
      outputDir,
      quality: "720",
      projectRoot: root,
    })).rejects.toThrow(/browser:chrome[\s\S]*browser:edge[\s\S]*browser:firefox/);
  });
});

function makeRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "douyin-cookie-strategy-"));
  roots.push(root);
  fs.mkdirSync(path.join(root, "raw", "剪藏", "抖音"), { recursive: true });
  return root;
}
