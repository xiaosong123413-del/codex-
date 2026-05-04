import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createConversation } from "../web/server/services/chat-store.js";
import { handleChatAddMessage } from "../web/server/routes/chat.js";

const tempRoots: string[] = [];

describe("chat guided ingest route", () => {
  afterEach(() => {
    while (tempRoots.length > 0) {
      const root = tempRoots.pop();
      if (root) fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("turns a selected inbox source into a guided wiki draft when the user confirms ingest", async () => {
    const projectRoot = makeRoot();
    const sourceVaultRoot = path.join(projectRoot, "source-vault");
    const runtimeRoot = path.join(projectRoot, ".runtime");
    fs.mkdirSync(path.join(sourceVaultRoot, "inbox"), { recursive: true });
    fs.mkdirSync(runtimeRoot, { recursive: true });
    fs.writeFileSync(path.join(sourceVaultRoot, "inbox", "source.md"), "# Guided Source\n\nBody", "utf8");
    const conversation = createConversation(sourceVaultRoot, {
      title: "Guided",
      articleRefs: ["inbox/source.md"],
    });
    const res = makeResponse();

    await handleChatAddMessage({
      projectRoot,
      sourceVaultRoot,
      runtimeRoot,
      port: 4175,
      host: "127.0.0.1",
      author: "tester",
    })(
      {
        params: { id: conversation.id },
        body: { content: "\u53ef\u4ee5\u5f55\u5165\u4e86", articleRefs: ["inbox/source.md"] },
      } as never,
      res as never,
    );

    expect(res.statusCode).toBe(200);
    expect(fs.existsSync(path.join(sourceVaultRoot, "wiki", "inbox", "Guided Source.md"))).toBe(true);
    expect(res.payload.data.messages.at(-1).content).toContain("\u5df2\u5b8c\u6210\u4eb2\u81ea\u6307\u5bfc\u5f55\u5165");
  });
});

function makeRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "chat-guided-"));
  tempRoots.push(root);
  return root;
}

function makeResponse() {
  return {
    statusCode: 200,
    payload: null as any,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.payload = payload;
      return this;
    },
  };
}
