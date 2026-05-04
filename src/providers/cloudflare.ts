/**
 * Cloudflare LLM provider implementation.
 *
 * Uses a configured Worker endpoint when available, otherwise calls
 * Cloudflare Workers AI REST directly for text generation.
 * Supports streaming via SSE and tool/function calling.
 */

import type { LLMMessage, LLMProvider, LLMTool } from "../utils/provider.js";
import { readCloudflareServicesConfig } from "../utils/cloudflare-services-config.js";
import {
  extractTextResponse,
  postCloudflareAiRun,
  postJsonStream,
  postWorkerJson,
  type CloudflareClientResult,
} from "../utils/cloudflare-http.js";

interface CloudflareTextPayload {
  system: string;
  messages: LLMMessage[];
  maxTokens: number;
  model: string | null;
}

interface OpenAITool {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

/** Cloudflare-backed LLM provider. */
export class CloudflareProvider implements LLMProvider {
  private readonly model: string | null;

  constructor(model: string | null = null) {
    this.model = model;
  }

  async complete(system: string, messages: LLMMessage[], maxTokens: number): Promise<string> {
    const payload = this.buildPayload(system, messages, maxTokens);
    const result = await this.sendText(payload);
    if (!result.ok) throw new Error(result.error.message);
    return extractTextResponse(result.data);
  }

  async stream(
    system: string,
    messages: LLMMessage[],
    maxTokens: number,
    onToken?: (text: string) => void,
  ): Promise<string> {
    const cfg = readCloudflareServicesConfig();

    if (cfg.accountId && cfg.apiToken && this.model) {
      return this.streamDirect(cfg.accountId, cfg.apiToken, system, messages, maxTokens, onToken);
    }

    // Worker mode: fall back to non-streaming (workers may not support SSE passthrough)
    const text = await this.complete(system, messages, maxTokens);
    onToken?.(text);
    return text;
  }

  async toolCall(
    system: string,
    messages: LLMMessage[],
    tools: LLMTool[],
    maxTokens: number,
  ): Promise<string> {
    const cfg = readCloudflareServicesConfig();

    if (cfg.accountId && cfg.apiToken && this.model) {
      return this.toolCallDirect(cfg.accountId, cfg.apiToken, system, messages, tools, maxTokens);
    }

    // Worker mode: send tools in payload for worker to handle
    const result = await postWorkerJson<unknown>(cfg, "llm", {
      system,
      messages,
      maxTokens,
      model: this.model,
      tools: tools.map(toOpenAITool),
    });
    if (!result.ok) throw new Error(result.error.message);
    return extractToolCallOrText(result.data);
  }

  private async streamDirect(
    accountId: string,
    apiToken: string,
    system: string,
    messages: LLMMessage[],
    maxTokens: number,
    onToken?: (text: string) => void,
  ): Promise<string> {
    const endpoint = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${this.model}`;
    const stream = await postJsonStream(endpoint, {
      messages: [{ role: "system", content: system }, ...messages],
      max_tokens: maxTokens,
    }, {
      Authorization: `Bearer ${apiToken}`,
    });

    let fullText = "";
    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta?.content ?? (!fullText ? extractTextResponse(chunk) : "");
      if (delta) {
        fullText += delta;
        onToken?.(delta);
      }
    }
    return fullText;
  }

  private async toolCallDirect(
    accountId: string,
    apiToken: string,
    system: string,
    messages: LLMMessage[],
    tools: LLMTool[],
    maxTokens: number,
  ): Promise<string> {
    const endpoint = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${this.model}`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${apiToken}`,
      },
      body: JSON.stringify({
        messages: [{ role: "system", content: system }, ...messages],
        max_tokens: maxTokens,
        tools: tools.map(toOpenAITool),
      }),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Cloudflare toolCall failed: HTTP ${response.status} - ${text}`);
    }
    const data = await response.json() as Record<string, unknown>;
    return extractToolCallOrText(data);
  }

  private buildPayload(
    system: string,
    messages: LLMMessage[],
    maxTokens: number,
  ): CloudflareTextPayload {
    return {
      system,
      messages,
      maxTokens,
      model: this.model,
    };
  }

  private async sendText(payload: CloudflareTextPayload): Promise<CloudflareClientResult<unknown>> {
    const cfg = readCloudflareServicesConfig();
    if (cfg.workerUrl && cfg.remoteToken) {
      return postWorkerJson<unknown>(cfg, "llm", payload);
    }
    return postCloudflareAiRun<unknown>(cfg, this.model, {
      messages: [{ role: "system", content: payload.system }, ...payload.messages],
      max_tokens: payload.maxTokens,
    });
  }
}

function toOpenAITool(tool: LLMTool): OpenAITool {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema,
    },
  };
}

function extractToolCallOrText(data: unknown): string {
  const toolArguments = firstToolCallArguments(resultRecord(data));
  if (toolArguments) return toolArguments;
  return extractTextResponse(data);
}

function resultRecord(data: unknown): Record<string, unknown> {
  const record = data && typeof data === "object" ? data as Record<string, unknown> : {};
  return record.result && typeof record.result === "object"
    ? record.result as Record<string, unknown>
    : record;
}

function firstToolCallArguments(result: Record<string, unknown>): string | null {
  const choices = result.choices as { message?: { tool_calls?: { function?: { arguments?: string } }[] } }[] | undefined;
  return choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments ?? null;
}
