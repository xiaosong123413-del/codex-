/**
 * Google Gemini LLM provider implementation.
 *
 * Uses the Gemini REST API (v1beta) for text generation, streaming,
 * and tool/function calling. Supports proxy via fetchWithOptionalProxy.
 */

import type { LLMMessage, LLMProvider, LLMTool } from "../utils/provider.js";
import { fetchWithOptionalProxy } from "../utils/proxy-fetch.js";

interface GeminiRequestPart {
  text?: string;
  functionCall?: { name: string; args: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
}

interface GeminiRequestContent {
  role: "user" | "model";
  parts: GeminiRequestPart[];
}

interface GeminiResponsePart {
  text?: string;
  functionCall?: { name: string; args: Record<string, unknown> };
}

interface GeminiResponseCandidate {
  content?: {
    parts?: GeminiResponsePart[];
  };
}

interface GeminiGenerateContentResponse {
  candidates?: GeminiResponseCandidate[];
}

interface GeminiFunctionDeclaration {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
}

export class GeminiProvider implements LLMProvider {
  private readonly model: string;
  private readonly baseURL: string;
  private readonly apiKey: string;

  constructor(model: string, baseURL?: string, apiKey?: string) {
    this.model = model;
    this.baseURL = normalizeBaseURL(baseURL ?? "https://generativelanguage.googleapis.com");
    this.apiKey = (apiKey ?? "").trim();
  }

  async complete(system: string, messages: LLMMessage[], maxTokens: number): Promise<string> {
    const response = await fetchWithOptionalProxy(this.endpoint("generateContent"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: toGeminiContents(messages),
        generationConfig: { maxOutputTokens: maxTokens },
      }),
    });
    if (!response.ok) {
      throw new Error(`Gemini request failed: HTTP ${response.status}`);
    }
    const payload = await response.json() as GeminiGenerateContentResponse;
    return extractTextFromResponse(payload);
  }

  async stream(
    system: string,
    messages: LLMMessage[],
    maxTokens: number,
    onToken?: (text: string) => void,
  ): Promise<string> {
    const response = await fetchWithOptionalProxy(this.endpoint("streamGenerateContent"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: toGeminiContents(messages),
        generationConfig: { maxOutputTokens: maxTokens },
      }),
    });
    if (!response.ok) {
      throw new Error(`Gemini stream failed: HTTP ${response.status}`);
    }

    let fullText = "";
    for await (const chunk of readNewlineDelimitedJson(response)) {
      const text = extractTextFromResponse(chunk);
      if (text) {
        fullText += text;
        onToken?.(text);
      }
    }
    return fullText;
  }

  async toolCall(
    system: string,
    messages: LLMMessage[],
    tools: LLMTool[],
    maxTokens: number,
  ): Promise<string> {
    const geminiTools = toGeminiTools(tools);
    const response = await fetchWithOptionalProxy(this.endpoint("generateContent"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: toGeminiContents(messages),
        tools: geminiTools,
        generationConfig: { maxOutputTokens: maxTokens },
      }),
    });
    if (!response.ok) {
      throw new Error(`Gemini toolCall failed: HTTP ${response.status}`);
    }
    const payload = await response.json() as GeminiGenerateContentResponse;
    return extractToolCallResult(payload);
  }

  private endpoint(method: string): string {
    const url = new URL(`/v1beta/models/${encodeURIComponent(this.model)}:${method}`, this.baseURL);
    if (this.apiKey) {
      url.searchParams.set("key", this.apiKey);
    }
    return url.toString();
  }
}

function extractTextFromResponse(payload: GeminiGenerateContentResponse): string {
  return payload.candidates?.[0]?.content?.parts
    ?.filter((p): p is { text: string } => typeof p.text === "string")
    .map((p) => p.text)
    .join("") ?? "";
}

function extractToolCallResult(payload: GeminiGenerateContentResponse): string {
  const parts = payload.candidates?.[0]?.content?.parts ?? [];
  for (const part of parts) {
    if (part.functionCall) {
      return JSON.stringify(part.functionCall.args);
    }
  }
  return extractTextFromResponse(payload);
}

function toGeminiTools(tools: LLMTool[]): { functionDeclarations: GeminiFunctionDeclaration[] }[] {
  return [{
    functionDeclarations: tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema,
    })),
  }];
}

function toGeminiContents(messages: LLMMessage[]): GeminiRequestContent[] {
  return messages.map((message) => ({
    role: message.role === "assistant" ? "model" : "user",
    parts: [{ text: message.content }],
  }));
}

function normalizeBaseURL(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

/**
 * Read newline-delimited JSON from a streaming response body.
 * Each line is a complete JSON object (Gemini streaming format).
 */
async function* readNewlineDelimitedJson(
  response: Response,
): AsyncGenerator<GeminiGenerateContentResponse> {
  const reader = response.body?.getReader();
  if (!reader) return;

  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const parsed = parseGeminiStreamBuffer(buffer);
      buffer = parsed.remainder;
      for (const chunk of parsed.chunks) {
        yield chunk;
      }
    }

    const finalChunk = parseGeminiStreamLine(buffer);
    if (finalChunk) {
      yield finalChunk;
    }
  } finally {
    reader.releaseLock();
  }
}

function parseGeminiStreamBuffer(
  buffer: string,
): { chunks: GeminiGenerateContentResponse[]; remainder: string } {
  const lines = buffer.split("\n");
  const remainder = lines.pop() ?? "";
  return {
    chunks: lines.map(parseGeminiStreamLine).filter(isGeminiResponse),
    remainder,
  };
}

function parseGeminiStreamLine(line: string): GeminiGenerateContentResponse | null {
  const cleaned = cleanGeminiStreamLine(line);
  if (!cleaned) return null;
  try {
    return JSON.parse(cleaned) as GeminiGenerateContentResponse;
  } catch {
    return null;
  }
}

function cleanGeminiStreamLine(line: string): string {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith(",")) return "";
  return trimmed.replace(/^\[|]$/g, "");
}

function isGeminiResponse(value: GeminiGenerateContentResponse | null): value is GeminiGenerateContentResponse {
  return value !== null;
}
