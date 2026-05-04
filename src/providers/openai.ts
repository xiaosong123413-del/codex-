/**
 * OpenAI LLM provider implementation.
 *
 * Wraps the openai npm package to implement the LLMProvider interface.
 * Translates Anthropic-style tool schemas (input_schema) to OpenAI format (parameters).
 */

import OpenAI from "openai";
import type { LLMProvider, LLMMessage, LLMTool } from "../utils/provider.js";

interface StreamTextState {
  fullText: string;
  reasoningOpen: boolean;
}

/** Translate an Anthropic-style LLMTool to an OpenAI ChatCompletionTool. */
export function translateToolToOpenAI(
  tool: LLMTool,
): OpenAI.ChatCompletionTool {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema,
    },
  };
}

/** OpenAI-backed LLM provider. */
export class OpenAIProvider implements LLMProvider {
  protected readonly client: OpenAI;
  protected readonly model: string;

  constructor(model: string, baseURL?: string, apiKey?: string, defaultHeaders?: Record<string, string>) {
    this.model = model;
    // The OpenAI SDK validates OPENAI_API_KEY at construction time.
    // Pass the key explicitly so the provider controls when validation happens.
    const resolvedKey = apiKey ?? process.env.OPENAI_API_KEY ?? "";
    this.client = new OpenAI({
      apiKey: resolvedKey,
      ...(baseURL ? { baseURL } : {}),
      ...(defaultHeaders ? { defaultHeaders } : {}),
    });
  }

  /** Send a single non-streaming completion request. */
  async complete(system: string, messages: LLMMessage[], maxTokens: number): Promise<string> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      max_tokens: maxTokens,
      messages: [{ role: "system", content: system }, ...messages],
    });

    return readMessageText(response.choices[0]?.message);
  }

  /** Stream a completion, invoking onToken for each text chunk. */
  async stream(
    system: string,
    messages: LLMMessage[],
    maxTokens: number,
    onToken?: (text: string) => void,
  ): Promise<string> {
    const stream = await this.client.chat.completions.create({
      model: this.model,
      max_tokens: maxTokens,
      messages: [{ role: "system", content: system }, ...messages],
      stream: true,
    });

    const state: StreamTextState = { fullText: "", reasoningOpen: false };
    for await (const chunk of stream) {
      appendStreamDelta(state, chunk.choices[0]?.delta, onToken);
    }
    closeReasoningBlock(state, onToken, "");

    return state.fullText;
  }

  /** Call the model with tool definitions and return the parsed tool input as JSON. */
  async toolCall(
    system: string,
    messages: LLMMessage[],
    tools: LLMTool[],
    maxTokens: number,
  ): Promise<string> {
    const openaiTools = tools.map(translateToolToOpenAI);

    const response = await this.client.chat.completions.create({
      model: this.model,
      max_tokens: maxTokens,
      messages: [{ role: "system", content: system }, ...messages],
      tools: openaiTools,
    });

    const toolCalls = response.choices[0]?.message?.tool_calls;
    if (toolCalls && toolCalls.length > 0) {
      return toolCalls[0].function.arguments;
    }

    return readMessageText(response.choices[0]?.message);
  }
}

function appendStreamDelta(
  state: StreamTextState,
  deltaRecord: unknown,
  onToken?: (text: string) => void,
): void {
  const reasoning = readReasoningText(deltaRecord);
  if (reasoning) {
    appendReasoningToken(state, reasoning, onToken);
    return;
  }
  closeReasoningBlock(state, onToken, "\n");
  appendChatToken(state, readChatText(readDeltaContent(deltaRecord)), onToken);
}

function appendReasoningToken(
  state: StreamTextState,
  reasoning: string,
  onToken?: (text: string) => void,
): void {
  const token = state.reasoningOpen ? reasoning : `<thinking>${reasoning}`;
  state.reasoningOpen = true;
  appendToken(state, token, onToken);
}

function closeReasoningBlock(
  state: StreamTextState,
  onToken: ((text: string) => void) | undefined,
  suffix: string,
): void {
  if (!state.reasoningOpen) return;
  state.reasoningOpen = false;
  appendToken(state, `</thinking>${suffix}`, onToken);
}

function appendChatToken(
  state: StreamTextState,
  token: string,
  onToken?: (text: string) => void,
): void {
  if (token) appendToken(state, token, onToken);
}

function appendToken(
  state: StreamTextState,
  token: string,
  onToken?: (text: string) => void,
): void {
  state.fullText += token;
  onToken?.(token);
}

function readMessageText(message: unknown): string {
  if (!message || typeof message !== "object") {
    return "";
  }
  const record = message as { content?: unknown };
  const reasoning = readReasoningText(record);
  const content = readChatText(record.content);
  return reasoning ? `<thinking>${reasoning}</thinking>\n${content}` : content;
}

function readReasoningText(value: unknown): string {
  if (!value || typeof value !== "object") {
    return "";
  }
  const record = value as {
    reasoning?: unknown;
    reasoning_content?: unknown;
    reasoningContent?: unknown;
  };
  return readChatText(record.reasoning_content ?? record.reasoningContent ?? record.reasoning);
}

function readDeltaContent(value: unknown): unknown {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  return (value as { content?: unknown }).content;
}

function readChatText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (!Array.isArray(value)) {
    return "";
  }
  return value.map(readChatTextPart).filter(Boolean).join("");
}

function readChatTextPart(value: unknown): string {
  if (!value || typeof value !== "object") {
    return "";
  }
  const record = value as { text?: unknown };
  return typeof record.text === "string" ? record.text : "";
}
