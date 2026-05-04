// @vitest-environment jsdom

/**
 * Regression tests for flash-diary visual editor markdown normalization.
 *
 * Verifies that legacy inline image paragraphs are lifted back into standalone
 * image blocks so saving does not keep concatenating markdown image syntax and
 * following diary text into a single paragraph.
 */
import { describe, expect, it } from "vitest";
import {
  createDiaryEditorHtml,
  serializeDiaryEditor,
} from "../web/client/src/pages/flash-diary/visual-editor-markdown.js";

describe("flash diary visual editor markdown helpers", () => {
  it("lifts an inline-rendered diary image into its own block before serialization", () => {
    const html = createDiaryEditorHtml(
      [
        "# 2026-04-28",
        "",
        "### 附件",
        "![图片附件](assets/2026-04-28/01.jpg)## 01:37",
        "我服了",
      ].join("\n"),
      [
        "<h1>2026-04-28</h1>",
        "<h3>附件</h3>",
        "<p><img src=\"assets/2026-04-28/01.jpg\" alt=\"图片附件\">## 01:37\n我服了</p>",
      ].join(""),
      "raw/闪念日记/2026-04-28.md",
    );

    const root = document.createElement("div");
    root.innerHTML = html;

    expect(root.querySelector("[data-flash-diary-image-block]")).toBeTruthy();
    expect(root.querySelector("p")?.textContent).not.toContain("图片附件");

    const markdown = serializeDiaryEditor(root);
    expect(markdown).toContain("![图片附件](./assets/2026-04-28/01.jpg)\n\n");
    expect(markdown).toContain("## 01:37\n\n我服了");
  });

  it("serializes diary video blocks as local markdown links", () => {
    const html = createDiaryEditorHtml(
      [
        "# 2026-04-28",
        "",
        "[视频：演示](./assets/2026-04-28/demo.mp4)",
      ].join("\n"),
      [
        "<h1>2026-04-28</h1>",
        "<p><a href=\"./assets/2026-04-28/demo.mp4\">视频：演示</a></p>",
      ].join(""),
      "raw/闪念日记/2026-04-28.md",
    );

    const root = document.createElement("div");
    root.innerHTML = html;

    expect(root.querySelector("[data-flash-diary-video-block]")).toBeTruthy();

    const markdown = serializeDiaryEditor(root);
    expect(markdown).toContain("[视频：演示](./assets/2026-04-28/demo.mp4)");
  });
});
