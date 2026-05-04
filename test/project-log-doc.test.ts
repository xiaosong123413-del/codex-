import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("project log document", () => {
  it("does not contain encoding replacement artifacts", () => {
    const root = process.cwd();
    const doc = fs.readFileSync(path.join(root, "docs", "project-log.md"), "utf8");

    expect(doc).not.toContain("\uFFFD");
    expect(doc).not.toContain("\\r\\n");
    expect(doc).not.toMatch(/!\[[^\]\n]*\.\.\/project-log-assets\//u);
    expect(doc).not.toContain("](../project-log-assets/)");
  });

  it("uses one image per independent DOM page instead of a single overview image", () => {
    const root = process.cwd();
    const doc = fs.readFileSync(path.join(root, "docs", "project-log.md"), "utf8");

    expect(doc).toContain("../project-log-assets/chat-page.svg");
    expect(doc).toContain("../project-log-assets/flash-diary-page.svg");
    expect(doc).toContain("../project-log-assets/sources-page.svg");
    expect(doc).toContain("../project-log-assets/wiki-page.svg");
    expect(doc).toContain("../project-log-assets/review-page.svg");
    expect(doc).toContain("../project-log-assets/settings-page.svg");
    expect(doc).not.toContain("current-interface.svg");
    expect(doc).not.toContain("项目日志页：独立全宽页面");
  });

  it("keeps the document sections ordered as interface, flow, then timeline", () => {
    const root = process.cwd();
    const doc = fs.readFileSync(path.join(root, "docs", "project-log.md"), "utf8");

    const interfaceIndex = doc.indexOf("## 现有界面");
    const flowIndex = doc.indexOf("## 现有流程");
    const timelineIndex = doc.indexOf("## 时间线");
    const firstTimelineEntryIndex = doc.indexOf("### [");

    expect(interfaceIndex).toBeGreaterThan(-1);
    expect(flowIndex).toBeGreaterThan(interfaceIndex);
    expect(timelineIndex).toBeGreaterThan(flowIndex);
    expect(firstTimelineEntryIndex).toBeGreaterThan(timelineIndex);
  });

  it("records the gbrain middle-layer migration in the timeline", () => {
    const root = process.cwd();
    const doc = fs.readFileSync(path.join(root, "docs", "project-log.md"), "utf8");

    expect(doc).toContain("[2026-04-21 02:07] gbrain 中层逻辑迁移首批收口");
    expect(doc).toContain("统一检索内核落成 `/api/search`");
    expect(doc).toContain("图片来源追溯、附件 / PDF / 视频追溯");
    expect(doc).toContain("媒体索引、OCR / 转写 sidecar 与 entity index");
    expect(doc).toContain("remote brain 仅保留 status / push / pull skeleton");
  });

  it("keeps pending items focused on concrete follow-up work", () => {
    const root = process.cwd();
    const pending = JSON.parse(
      fs.readFileSync(path.join(root, "docs", "project-pending.json"), "utf8"),
    ) as Array<{ id: string; title: string; nextStep: string }>;

    const ids = new Set(pending.map((item) => item.id));

    expect(ids.has("search-eval-expanded-corpus")).toBe(false);
    expect(ids.has("vector-search-embedding")).toBe(false);
    expect(ids.has("media-real-ocr-transcription")).toBe(false);
    expect(ids.has("remote-brain-cloud-service")).toBe(false);
    expect(ids.has("web-search-api-integration")).toBe(false);
    expect(ids.has("desktop-codex-subscription-login")).toBe(false);
    expect(ids.has("flash-diary-audio-transcription")).toBe(false);
    expect(ids.has("mobile-codex-subscription-login")).toBe(false);
    expect(ids.has("mobile-offline-chat")).toBe(false);
    expect(ids.has("lint-image-source-trace")).toBe(false);
    expect(ids.has("lint-asset-pdf-video-trace")).toBe(false);
    expect(ids.has("lint-lifecycle-confidence")).toBe(false);
  });

  it("documents the desktop flow as launcher-only", () => {
    const root = process.cwd();
    const doc = fs.readFileSync(path.join(root, "docs", "project-log.md"), "utf8");

    expect(doc).toContain("桌面入口当前只支持 launcher 路线");
    expect(doc).toContain("desktop-webui-launcher/");
    expect(doc).toContain("desktop-webui/` 只作为 launcher 启动的 Electron 运行时");
    expect(doc).not.toContain("desktop:webui:package");
  });
});
