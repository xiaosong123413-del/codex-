import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  addConversationMessage,
  createConversation,
  deleteConversation,
  getConversation,
  listConversations,
  removeLastAssistantUserPair,
  updateConversation,
} from "../web/server/services/chat-store.js";

const tempRoots: string[] = [];

describe("chat-store", () => {
  afterEach(() => {
    while (tempRoots.length > 0) {
      const root = tempRoots.pop();
      if (root && fs.existsSync(root)) {
        fs.rmSync(root, { recursive: true, force: true });
      }
    }
  });

  it("creates a conversation and lists it from the .llm-wiki directory", () => {
    const root = createTempRoot();

    const conversation = createConversation(root, { title: "First thread" });
    const summaries = listConversations(root);

    expect(conversation.title).toBe("First thread");
    expect(fs.existsSync(path.join(root, ".llm-wiki", "conversations.json"))).toBe(true);
    expect(fs.existsSync(path.join(root, ".llm-wiki", "chats", `${conversation.id}.json`))).toBe(true);
    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.id).toBe(conversation.id);
  });

  it("persists appended messages and article refs", () => {
    const root = createTempRoot();
    const conversation = createConversation(root, { title: "Thread" });

    addConversationMessage(root, conversation.id, {
      role: "user",
      content: "hello",
      articleRefs: ["wiki/concepts/example.md"],
    });

    const stored = getConversation(root, conversation.id);
    expect(stored?.messages).toHaveLength(1);
    expect(stored?.messages[0]?.content).toBe("hello");
    expect(stored?.messages[0]?.articleRefs).toEqual(["wiki/concepts/example.md"]);
  });

  it("persists assistant message references", () => {
    const root = createTempRoot();
    const conversation = createConversation(root, { title: "Thread" });

    addConversationMessage(root, conversation.id, {
      role: "assistant",
      content: "Answer [1]",
      references: [{
        index: 1,
        kind: "wiki",
        title: "Example",
        path: "wiki/concepts/example.md",
        excerpt: "Example excerpt",
      }],
    });

    const stored = getConversation(root, conversation.id);
    expect(stored?.messages[0]?.references).toEqual([{
      index: 1,
      kind: "wiki",
      title: "Example",
      path: "wiki/concepts/example.md",
      excerpt: "Example excerpt",
    }]);
  });

  it("updates title, web search flag, search scope, and app binding", () => {
    const root = createTempRoot();
    const conversation = createConversation(root, { title: "Before" });

    const updated = updateConversation(root, conversation.id, {
      title: "After",
      webSearchEnabled: true,
      searchScope: "all",
      appId: "codex-app",
    });

    expect(updated?.title).toBe("After");
    expect(updated?.webSearchEnabled).toBe(true);
    expect(updated?.searchScope).toBe("all");
    expect(updated?.appId).toBe("codex-app");
  });

  it("creates a conversation with initial web search, app binding, and article refs", () => {
    const root = createTempRoot();

    const conversation = createConversation(root, {
      title: "Seeded",
      webSearchEnabled: true,
      searchScope: "web",
      appId: "research-app",
      articleRefs: ["wiki/seed.md"],
    });

    expect(conversation.webSearchEnabled).toBe(true);
    expect(conversation.searchScope).toBe("web");
    expect(conversation.appId).toBe("research-app");
    expect(conversation.articleRefs).toEqual(["wiki/seed.md"]);
  });

  it("reads legacy conversation files that still use agentId and maps them to appId", () => {
    const root = createTempRoot();
    const dir = path.join(root, ".chat");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "legacy.json"), JSON.stringify({
      id: "legacy",
      title: "Legacy thread",
      createdAt: "2026-04-25T00:00:00.000Z",
      updatedAt: "2026-04-25T00:00:00.000Z",
      webSearchEnabled: false,
      searchScope: "local",
      agentId: "legacy-agent",
      articleRefs: [],
      messages: [],
    }, null, 2));

    const conversation = getConversation(root, "legacy");

    expect(conversation?.appId).toBe("legacy-agent");
  });

  it("migrates legacy .chat conversations into the .llm-wiki format", () => {
    const root = createTempRoot();
    const dir = path.join(root, ".chat");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "legacy.json"), JSON.stringify({
      id: "legacy",
      title: "Legacy thread",
      createdAt: "2026-04-25T00:00:00.000Z",
      updatedAt: "2026-04-25T00:00:00.000Z",
      webSearchEnabled: false,
      searchScope: "local",
      articleRefs: [],
      messages: [{ id: "m1", role: "user", content: "hello", createdAt: "2026-04-25T00:00:00.000Z" }],
    }, null, 2));

    expect(getConversation(root, "legacy")?.messages[0]?.content).toBe("hello");
    expect(fs.existsSync(path.join(root, ".llm-wiki", "chats", "legacy.json"))).toBe(true);
  });

  it("migrates legacy flat chat history with conversations and grouped messages", () => {
    const root = createTempRoot();
    fs.mkdirSync(path.join(root, ".llm-wiki"), { recursive: true });
    fs.writeFileSync(path.join(root, ".llm-wiki", "chat-history.json"), JSON.stringify({
      conversations: [{
        id: "conv_1",
        title: "Old thread",
        createdAt: 1_776_528_000_000,
        updatedAt: 1_776_528_001_000,
      }],
      messages: [{
        id: "m1",
        role: "assistant",
        content: "Answer [1]",
        timestamp: 1_776_528_001_000,
        conversationId: "conv_1",
        references: [{
          index: 1,
          kind: "wiki",
          title: "Redis",
          path: "wiki/concepts/redis.md",
          excerpt: "Redis excerpt",
        }],
      }],
    }, null, 2));

    const conversation = getConversation(root, "conv_1");

    expect(conversation?.title).toBe("Old thread");
    expect(conversation?.messages[0]?.content).toBe("Answer [1]");
    expect(conversation?.messages[0]?.references?.[0]?.path).toBe("wiki/concepts/redis.md");
    expect(fs.existsSync(path.join(root, ".llm-wiki", "chats", "conv_1.json"))).toBe(true);
  });

  it("removes the last assistant and user pair for regenerate", () => {
    const root = createTempRoot();
    const conversation = createConversation(root, { title: "Thread" });
    addConversationMessage(root, conversation.id, { role: "user", content: "first" });
    addConversationMessage(root, conversation.id, { role: "assistant", content: "answer" });

    const turn = removeLastAssistantUserPair(root, conversation.id);

    expect(turn?.content).toBe("first");
    expect(getConversation(root, conversation.id)?.messages).toHaveLength(0);
  });

  it("deletes a conversation from the .llm-wiki directory", () => {
    const root = createTempRoot();
    const conversation = createConversation(root, { title: "Disposable" });

    const deleted = deleteConversation(root, conversation.id);

    expect(deleted).toBe(true);
    expect(getConversation(root, conversation.id)).toBeNull();
    expect(listConversations(root)).toHaveLength(0);
  });
});

function createTempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "llmwiki-chat-"));
  tempRoots.push(root);
  return root;
}
