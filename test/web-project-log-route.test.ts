import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  handleProjectLog,
  handleProjectWorkspace,
  handleProjectWorkspaceDelete,
} from "../web/server/routes/pages.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("project log routes", () => {
  it("reads docs/project-log.md from the project root", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "llmwiki-project-log-"));
    tempDirs.push(root);
    fs.mkdirSync(path.join(root, "docs"), { recursive: true });
    fs.writeFileSync(path.join(root, "docs", "project-log.md"), "# LLM Wiki 项目日志\n\n## 时间线\n", "utf8");
    const json = vi.fn();
    const handler = handleProjectLog({
      projectRoot: root,
      wikiRoot: root,
      host: "127.0.0.1",
      port: 4175,
      author: "me",
    });

    handler({} as never, { json } as never);

    expect(json).toHaveBeenCalledWith({
      success: true,
      data: expect.objectContaining({
        path: "docs/project-log.md",
        raw: expect.stringContaining("时间线"),
        html: expect.stringContaining("<h1"),
      }),
    });
    expect(json.mock.calls[0]?.[0].data.html).not.toContain("§");
  });

  it("lists workspace groups with delete recommendations", () => {
    const root = createGitWorkspace();
    fs.mkdirSync(path.join(root, "docs"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "docs", "project-pending.json"),
      `${JSON.stringify([
        {
          id: "wiki-clone-backlinks",
          title: "Wiki 页面反向链接补全",
          area: "Wiki 阅读页",
          status: "MVP 后续",
          description: "让 wiki 阅读页补齐严格 Wikipedia 仿站里的反向链接能力。",
          pausedReason: "先交付可阅读入口，完整仿站交互放到后续。",
          nextStep: "在 wiki 页面数据接口里补 backlinks，再渲染到阅读页。",
        },
      ], null, 2)}\n`,
      "utf8",
    );
    fs.mkdirSync(path.join(root, "wiki-clone", ".next"), { recursive: true });
    fs.writeFileSync(path.join(root, "gui-panel-state.json"), "{\"sidebar\":true}\n", "utf8");
    fs.writeFileSync(path.join(root, "README.md"), "tracked\n", "utf8");
    execFileSync("git", ["-C", root, "add", "README.md"], { stdio: "ignore" });
    execFileSync("git", ["-C", root, "commit", "-m", "init"], { stdio: "ignore" });
    fs.appendFileSync(path.join(root, "README.md"), "changed\n", "utf8");

    const json = vi.fn();
    const handler = handleProjectWorkspace({
      projectRoot: root,
      wikiRoot: root,
      host: "127.0.0.1",
      port: 4175,
      author: "me",
    });

    handler({} as never, { json, status: vi.fn().mockReturnThis() } as never);

    const payload = json.mock.calls[0]?.[0];
    expect(payload.success).toBe(true);
    expect(payload.data.pending).toEqual([
      expect.objectContaining({
        title: "Wiki 页面反向链接补全",
        status: "MVP 后续",
      }),
    ]);
    expect(payload.data.groups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "构建产物与本地状态",
          entries: expect.arrayContaining([
            expect.objectContaining({
              path: "gui-panel-state.json",
              recommendation: "delete",
            }),
            expect.objectContaining({
              path: "wiki-clone/.next/",
              recommendation: "delete",
            }),
          ]),
        }),
        expect.objectContaining({
          name: "根目录配置",
          entries: expect.arrayContaining([
            expect.objectContaining({
              path: "README.md",
              recommendation: "keep",
            }),
          ]),
        }),
      ]),
    );
  });

  it("deletes a workspace entry inside the project root", () => {
    const root = createGitWorkspace();
    fs.writeFileSync(path.join(root, "gui-panel-state.json"), "{\"sidebar\":true}\n", "utf8");
    const json = vi.fn();
    const status = vi.fn().mockReturnThis();
    const handler = handleProjectWorkspaceDelete({
      projectRoot: root,
      wikiRoot: root,
      host: "127.0.0.1",
      port: 4175,
      author: "me",
    });

    handler(
      {
        body: {
          path: "gui-panel-state.json",
        },
      } as never,
      { json, status } as never,
    );

    expect(fs.existsSync(path.join(root, "gui-panel-state.json"))).toBe(false);
    expect(json).toHaveBeenCalledWith({ success: true });
  });
});

function createGitWorkspace(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "llmwiki-project-log-workspace-"));
  tempDirs.push(root);
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "codex@example.com"], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["config", "user.name", "Codex"], { cwd: root, stdio: "ignore" });
  return root;
}
