/**
 * OpenAI provider response parsing tests.
 *
 * Covers OpenAI-compatible proxies that return content blocks instead of a
 * plain string, so chat does not persist an empty assistant answer.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

const { createMock } = vi.hoisted(() => ({
  createMock: vi.fn(),
}));

vi.mock("openai", () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: createMock,
      },
    },
  })),
}));

const { OpenAIProvider } = await import("../src/providers/openai.js");

describe("OpenAIProvider", () => {
  beforeEach(() => {
    createMock.mockReset();
  });

  it("reads block-array message content from non-streaming responses", async () => {
    createMock.mockResolvedValue({
      choices: [{
        message: {
          content: [
            { type: "output_text", text: "第一段" },
            { type: "output_text", text: "第二段" },
          ],
        },
      }],
    });

    const provider = new OpenAIProvider("gpt-test", "http://127.0.0.1:8317/v1", "key");

    await expect(provider.complete("system", [{ role: "user", content: "hello" }], 100))
      .resolves.toBe("第一段第二段");
  });

  it("streams block-array delta content", async () => {
    createMock.mockResolvedValue(streamChunks([
      { choices: [{ delta: { content: [{ type: "output_text", text: "你" }] } }] },
      { choices: [{ delta: { content: [{ type: "output_text", text: "好" }] } }] },
    ]));
    const tokens: string[] = [];
    const provider = new OpenAIProvider("gpt-test", "http://127.0.0.1:8317/v1", "key");

    const result = await provider.stream("system", [{ role: "user", content: "hello" }], 100, (token) => {
      tokens.push(token);
    });

    expect(result).toBe("你好");
    expect(tokens).toEqual(["你", "好"]);
  });

  it("wraps OpenAI-compatible reasoning fields as thinking blocks", async () => {
    createMock.mockResolvedValue({
      choices: [{
        message: {
          reasoning_content: "先判断问题",
          content: "正式回答",
        },
      }],
    });
    const provider = new OpenAIProvider("gpt-test", "http://127.0.0.1:8317/v1", "key");

    await expect(provider.complete("system", [{ role: "user", content: "hello" }], 100))
      .resolves.toBe("<thinking>先判断问题</thinking>\n正式回答");
  });

  it("streams reasoning deltas before answer deltas", async () => {
    createMock.mockResolvedValue(streamChunks([
      { choices: [{ delta: { reasoning_content: "先判断" } }] },
      { choices: [{ delta: { reasoning_content: "再回答" } }] },
      { choices: [{ delta: { content: "正式回答" } }] },
    ]));
    const tokens: string[] = [];
    const provider = new OpenAIProvider("gpt-test", "http://127.0.0.1:8317/v1", "key");

    const result = await provider.stream("system", [{ role: "user", content: "hello" }], 100, (token) => tokens.push(token));

    expect(result).toBe("<thinking>先判断再回答</thinking>\n正式回答");
    expect(tokens).toEqual(["<thinking>先判断", "再回答", "</thinking>\n", "正式回答"]);
  });
});

async function* streamChunks(chunks: unknown[]): AsyncGenerator<unknown> {
  for (const chunk of chunks) {
    yield chunk;
  }
}
