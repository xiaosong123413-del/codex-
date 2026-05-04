import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { handlePage } from "../web/server/routes/pages.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("wiki chat evidence links", () => {
  it("links evidence timestamps to chat records and anchors transcript messages", () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "llmwiki-chat-links-"));
    const sourceVaultRoot = path.join(projectRoot, "source-vault");
    const runtimeRoot = path.join(projectRoot, ".runtime");
    tempDirs.push(projectRoot);
    fs.mkdirSync(path.join(sourceVaultRoot, "wiki", "crm"), { recursive: true });
    fs.mkdirSync(path.join(sourceVaultRoot, "wiki", "聊天记录"), { recursive: true });
    fs.mkdirSync(runtimeRoot, { recursive: true });

    fs.writeFileSync(
      path.join(sourceVaultRoot, "wiki", "crm", "test-person.md"),
      [
        "# Test Person",
        "",
        "- [[聊天记录/test-chat]]",
        "",
        "证据：[2026-04-02 00:44] oiii：我看完了",
        "",
      ].join("\n"),
      "utf8",
    );

    fs.writeFileSync(
      path.join(sourceVaultRoot, "wiki", "聊天记录", "test-chat.md"),
      [
        "# Test Chat",
        "",
        "- `2026-04-02 00:44` **oiii**：我看完了",
        "",
      ].join("\n"),
      "utf8",
    );

    const handler = handlePage({
      projectRoot,
      sourceVaultRoot,
      runtimeRoot,
      host: "127.0.0.1",
      port: 4175,
      author: "me",
    });

    const crmJson = vi.fn();
    handler({ query: { path: "wiki/crm/test-person.md" } } as never, { json: crmJson, status: vi.fn() } as never);
    const crmPayload = crmJson.mock.calls[0]?.[0] as { html: string } | undefined;

    const chatJson = vi.fn();
    handler({ query: { path: "wiki/聊天记录/test-chat.md" } } as never, { json: chatJson, status: vi.fn() } as never);
    const chatPayload = chatJson.mock.calls[0]?.[0] as { html: string } | undefined;

    expect(crmPayload?.html).toContain('/?page=wiki%2F%E8%81%8A%E5%A4%A9%E8%AE%B0%E5%BD%95%2Ftest-chat.md');
    expect(crmPayload?.html).toContain("#/wiki/wiki%2F%E8%81%8A%E5%A4%A9%E8%AE%B0%E5%BD%95%2Ftest-chat.md#msg-2026-04-02-00-44");
    expect(crmPayload?.html).toContain('class="wiki-evidence-timestamp"');
    expect(crmPayload?.html).toContain('[2026-04-02 00:44]</a> oiii：我看完了');
    expect(chatPayload?.html).toContain('<li id="msg-2026-04-02-00-44"><code>2026-04-02 00:44</code> <strong>oiii</strong>：我看完了</li>');
  });

  it("uses unique anchors when one minute contains multiple chat messages", () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "llmwiki-chat-links-"));
    const sourceVaultRoot = path.join(projectRoot, "source-vault");
    const runtimeRoot = path.join(projectRoot, ".runtime");
    tempDirs.push(projectRoot);
    fs.mkdirSync(path.join(sourceVaultRoot, "wiki", "crm"), { recursive: true });
    fs.mkdirSync(path.join(sourceVaultRoot, "wiki", "聊天记录"), { recursive: true });
    fs.mkdirSync(runtimeRoot, { recursive: true });

    fs.writeFileSync(
      path.join(sourceVaultRoot, "wiki", "crm", "test-person.md"),
      [
        "# Test Person",
        "",
        "- [[聊天记录/test-chat]]",
        "",
        "证据：[2026-04-02 00:44] oiii: 第二条消息",
        "",
      ].join("\n"),
      "utf8",
    );

    fs.writeFileSync(
      path.join(sourceVaultRoot, "wiki", "聊天记录", "test-chat.md"),
      [
        "# Test Chat",
        "",
        "- `2026-04-02 00:44` **oiii**：第一条消息",
        "- `2026-04-02 00:44` **oiii**：第二条消息",
        "",
      ].join("\n"),
      "utf8",
    );

    const handler = handlePage({
      projectRoot,
      sourceVaultRoot,
      runtimeRoot,
      host: "127.0.0.1",
      port: 4175,
      author: "me",
    });

    const crmJson = vi.fn();
    handler({ query: { path: "wiki/crm/test-person.md" } } as never, { json: crmJson, status: vi.fn() } as never);
    const crmPayload = crmJson.mock.calls[0]?.[0] as { html: string } | undefined;

    const chatJson = vi.fn();
    handler({ query: { path: "wiki/聊天记录/test-chat.md" } } as never, { json: chatJson, status: vi.fn() } as never);
    const chatPayload = chatJson.mock.calls[0]?.[0] as { html: string } | undefined;

    expect(crmPayload?.html).toContain("#/wiki/wiki%2F%E8%81%8A%E5%A4%A9%E8%AE%B0%E5%BD%95%2Ftest-chat.md#msg-2026-04-02-00-44-2");
    expect(chatPayload?.html).toContain('<li id="msg-2026-04-02-00-44"><code>2026-04-02 00:44</code> <strong>oiii</strong>：第一条消息</li>');
    expect(chatPayload?.html).toContain('<li id="msg-2026-04-02-00-44-2"><code>2026-04-02 00:44</code> <strong>oiii</strong>：第二条消息</li>');
  });

  it("keeps diary heading links alive as personal evidence anchors", () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "llmwiki-diary-evidence-"));
    const sourceVaultRoot = path.join(projectRoot, "source-vault");
    const runtimeRoot = path.join(projectRoot, ".runtime");
    const diaryPath = "raw/闪念日记/2026-04-29.md";
    tempDirs.push(projectRoot);
    fs.mkdirSync(path.join(sourceVaultRoot, "wiki", "个人信息档案"), { recursive: true });
    fs.mkdirSync(path.join(sourceVaultRoot, "raw", "闪念日记"), { recursive: true });
    fs.mkdirSync(runtimeRoot, { recursive: true });

    fs.writeFileSync(
      path.join(sourceVaultRoot, "wiki", "个人信息档案", "个人信息和事实.md"),
      [
        "# 个人信息和事实",
        "",
        "- 我对独立发展叙事较敏感。来源：[[raw/闪念日记/2026-04-29.md#让 ChatGPT 看手相|一次手相/AI 手相解读]]",
        "",
      ].join("\n"),
      "utf8",
    );

    fs.writeFileSync(
      path.join(sourceVaultRoot, "raw", "闪念日记", "2026-04-29.md"),
      [
        "# 2026-04-29 闪念日记",
        "",
        "## 让 ChatGPT 看手相",
        "",
        "![左手](assets/2026-04-29/left.png)",
        "",
        "ChatGPT 给出了一段很长的解释。",
        "",
      ].join("\n"),
      "utf8",
    );

    const handler = handlePage({
      projectRoot,
      sourceVaultRoot,
      runtimeRoot,
      host: "127.0.0.1",
      port: 4175,
      author: "me",
    });

    const factsJson = vi.fn();
    handler(
      { query: { path: "wiki/个人信息档案/个人信息和事实.md" } } as never,
      { json: factsJson, status: vi.fn() } as never,
    );
    const factsPayload = factsJson.mock.calls[0]?.[0] as { html: string } | undefined;

    const diaryJson = vi.fn();
    handler({ query: { path: diaryPath } } as never, { json: diaryJson, status: vi.fn() } as never);
    const diaryPayload = diaryJson.mock.calls[0]?.[0] as { html: string } | undefined;
    const expectedHref = `/?page=${encodeURIComponent(diaryPath)}#${encodeURIComponent("让-chatgpt-看手相")}`;

    expect(factsPayload?.html).toContain(`href="${expectedHref}"`);
    expect(factsPayload?.html).toContain('class="wikilink wikilink-alive"');
    expect(factsPayload?.html).not.toContain(`${expectedHref}#`);
    expect(diaryPayload?.html).toContain('id="让-chatgpt-看手相"');
  });
});
