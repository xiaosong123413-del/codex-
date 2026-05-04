/**
 * Focused tests for the chat message markdown helpers.
 *
 * These assertions lock down the lightweight formatting behavior that the chat
 * page depends on, so UI refactors can move parsing code without changing the
 * rendered output.
 */

import { describe, expect, it } from "vitest";
import { extractThinkingBlocks, isCompactMessage, renderMessageHtml } from "../web/client/src/pages/chat/message-markdown.js";

describe("chat message markdown helpers", () => {
  it("treats short single-line messages as compact even with inline markdown", () => {
    expect(isCompactMessage("**简短回答**")).toBe(true);
    expect(isCompactMessage("第一行\n第二行")).toBe(false);
  });

  it("renders headings, blockquotes, lists, code fences, and safe links", () => {
    const html = renderMessageHtml(
      [
        "# 标题",
        "",
        "> 第一行",
        "> 第二行",
        "",
        "- 列表项",
        "",
        "```ts",
        'console.log(\"ok\")',
        "```",
        "",
        "[OpenAI](https://openai.com)",
      ].join("\n"),
    );

    expect(html).toContain("<h1>标题</h1>");
    expect(html).toContain("<blockquote><p>第一行<br>第二行</p></blockquote>");
    expect(html).toContain("<ul><li>列表项</li></ul>");
    expect(html).toContain('<pre><code data-language="ts">console.log(&quot;ok&quot;)</code></pre>');
    expect(html).toContain('<a href="https://openai.com" target="_blank" rel="noreferrer">OpenAI</a>');
  });

  it("drops unsafe link targets back to plain text", () => {
    const html = renderMessageHtml("[危险链接](javascript:alert(1))");
    expect(html).toContain("危险链接");
    expect(html).not.toContain("<a ");
  });

  it("renders markdown images through the local media endpoint", () => {
    const html = renderMessageHtml("![Revenue chart](wiki/media/q2/image-001.png)");
    expect(html).toContain('<img src="/api/source-gallery/media?path=wiki%2Fmedia%2Fq2%2Fimage-001.png"');
    expect(html).toContain('alt="Revenue chart"');
  });

  it("drops unsafe image targets back to alt text", () => {
    const html = renderMessageHtml("![Bad image](javascript:alert(1))");
    expect(html).toContain("Bad image");
    expect(html).not.toContain("<img ");
  });

  it("hides cited reference comments from rendered messages", () => {
    const html = renderMessageHtml("回答内容。[1]\n<!-- cited: 1, 3 -->");
    expect(html).toContain("回答内容。[1]");
    expect(html).not.toContain("cited:");
  });

  it("separates thinking blocks from rendered answer content", () => {
    const content = "<think>第一步\n第二步</think>\n最终回答";

    expect(renderMessageHtml(content)).toContain("最终回答");
    expect(renderMessageHtml(content)).not.toContain("第一步");
    expect(extractThinkingBlocks(content)).toEqual([{ content: "第一步\n第二步" }]);
  });

  it("extracts open-ended thinking blocks while streaming", () => {
    const content = "<thinking>line one\nline two";

    expect(renderMessageHtml(content)).toBe("<p></p>");
    expect(extractThinkingBlocks(content)).toEqual([{ content: "line one\nline two" }]);
  });
});
