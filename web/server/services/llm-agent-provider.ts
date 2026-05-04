/**
 * Agent-specific LLM provider resolution for chat sessions.
 *
 * This module isolates account-ref parsing and runtime provider routing so the
 * chat service can focus on prompt assembly and message flow.
 */

import type { Conversation } from "./chat-store.js";
import { readAgentConfig, type AgentDefinition } from "./agent-config.js";
import { readCLIProxyConfig } from "./cliproxy-config.js";
import { readLlmApiAccount } from "./llm-accounts.js";
import {
  ACCOUNT_CODEX_OAUTH_REF,
  accountAiOpenAiBaseUrl,
  readAccountAiSyncConfig,
} from "./account-ai-env.js";
import { getProvider, type LLMProvider } from "../../../src/utils/provider.js";
import { AnthropicProvider } from "../../../src/providers/anthropic.js";
import { CloudflareProvider } from "../../../src/providers/cloudflare.js";
import { GeminiProvider } from "../../../src/providers/gemini.js";
import { MiniMaxProvider } from "../../../src/providers/minimax.js";
import { OpenAIProvider } from "../../../src/providers/openai.js";
import { OllamaProvider } from "../../../src/providers/ollama.js";

interface CodexAgentProviderRoute {
  baseURL: string;
  apiKey: string;
  model: string;
  headers?: Record<string, string>;
}

interface ParsedAgentAccountRef {
  kind: "api" | "oauth" | "cloudflare";
  provider: string;
  key: string;
}

export function resolveAgentRuntimeProvider(projectRoot: string, agent: AgentDefinition | null, sessionKey: string): LLMProvider {
  const resolvedAgent = resolveRuntimeAgent(projectRoot, agent);
  if (!resolvedAgent) {
    throw new Error("未配置默认应用，请先在设置页创建并启用应用。");
  }
  const accountProvider = resolveAgentAccountProvider(projectRoot, resolvedAgent, sessionKey);
  if (accountProvider) {
    return accountProvider;
  }
  const codexRoute = resolveCodexAgentProviderRoute(projectRoot, resolvedAgent, sessionKey);
  if (codexRoute) {
    return new OpenAIProvider(codexRoute.model, codexRoute.baseURL, codexRoute.apiKey, codexRoute.headers);
  }
  return getProvider();
}

export function resolveCodexAgentProviderRoute(
  projectRoot: string,
  conversation: Conversation,
  agent: AgentDefinition | null,
): CodexAgentProviderRoute | null;
export function resolveCodexAgentProviderRoute(
  projectRoot: string,
  agent: AgentDefinition | null,
  sessionKey: string,
): CodexAgentProviderRoute | null;
export function resolveCodexAgentProviderRoute(
  projectRoot: string,
  first: Conversation | AgentDefinition | null,
  second: AgentDefinition | string | null,
): CodexAgentProviderRoute | null {
  const agent = typeof second === "string" ? first as AgentDefinition | null : second;
  const sessionKey = typeof second === "string" ? second : `conversation:${(first as Conversation).id}`;
  if (!agent || !isCodexAgentProvider(agent.provider)) {
    return null;
  }
  const config = readCLIProxyConfig(projectRoot);
  return {
    baseURL: `http://127.0.0.1:${config.port}/v1`,
    apiKey: config.clientKey,
    model: agent.model.trim() || config.model,
    headers: { "X-Session-ID": `agent:${agent.id}:${sessionKey}` },
  };
}

function resolveRuntimeAgent(projectRoot: string, agent: AgentDefinition | null): AgentDefinition | null {
  if (agent) {
    return agent;
  }
  const config = readAgentConfig(projectRoot);
  return config.agents.find((item) => item.id === config.activeAgentId && item.enabled) ?? null;
}

function resolveAgentAccountProvider(
  projectRoot: string,
  agent: AgentDefinition,
  sessionKey: string,
): LLMProvider | null {
  const route = parseAgentAccountRef(normalizeText(agent.accountRef));
  if (!route) return null;
  if (route.kind === "api") {
    return resolveApiAccountProvider(projectRoot, agent, route);
  }
  if (route.kind === "cloudflare") {
    return resolveCloudflareAccountProvider(agent);
  }
  return resolveOAuthAccountProvider(projectRoot, agent, route, sessionKey);
}

function resolveApiAccountProvider(
  projectRoot: string,
  agent: AgentDefinition,
  route: ParsedAgentAccountRef,
): LLMProvider | null {
  const account = readLlmApiAccount(projectRoot, route.key);
  if (!account || account.enabled === false) return null;
  return buildApiAccountProvider(account.provider, account.url, account.key, agent.model.trim() || account.model);
}

function resolveCloudflareAccountProvider(agent: AgentDefinition): LLMProvider {
  return new CloudflareProvider(agent.model.trim() || null);
}

function resolveOAuthAccountProvider(
  projectRoot: string,
  agent: AgentDefinition,
  route: ParsedAgentAccountRef,
  sessionKey: string,
): LLMProvider {
  if (`oauth:${route.provider}:${route.key}` === ACCOUNT_CODEX_OAUTH_REF) {
    const accountConfig = readAccountAiSyncConfig();
    if (!accountConfig) throw new Error("请先登录桌面账号，才能使用 Worker Codex OAuth。");
    return new OpenAIProvider(
      agent.model.trim() || "gpt-5.5",
      accountAiOpenAiBaseUrl(accountConfig.workerUrl),
      accountConfig.sessionToken,
      { "X-Session-ID": `agent:${agent.id}:oauth:codex:worker:${sessionKey}` },
    );
  }
  const config = readCLIProxyConfig(projectRoot);
  return new OpenAIProvider(
    agent.model.trim() || config.model,
    `http://127.0.0.1:${config.port}/v1`,
    config.clientKey,
    { "X-Session-ID": `agent:${agent.id}:oauth:${route.provider}:${route.key}:${sessionKey}` },
  );
}

function buildApiAccountProvider(provider: string, url: string, key: string, model: string): LLMProvider {
  if (provider === "anthropic") {
    return new AnthropicProvider(model, { apiKey: key, baseURL: url });
  }
  if (provider === "gemini") {
    return new GeminiProvider(model, url, key);
  }
  if (provider === "minimax") {
    return new MiniMaxProvider(model, key, url);
  }
  if (provider === "ollama") {
    return new OllamaProvider(model, url);
  }
  return new OpenAIProvider(model, url, key);
}

function parseAgentAccountRef(value: string | null): ParsedAgentAccountRef | null {
  if (!value) return null;
  if (value === "cloudflare:workers-ai") {
    return { kind: "cloudflare", provider: "cloudflare", key: "workers-ai" };
  }
  if (value.startsWith("api:")) {
    const key = value.slice(4).trim();
    if (!key) return null;
    return { kind: "api", provider: "api", key };
  }
  if (value.startsWith("oauth:")) {
    const parts = value.split(":");
    if (parts.length < 3) return null;
    const provider = parts[1]?.trim();
    const key = parts.slice(2).join(":").trim();
    if (!provider || !key) return null;
    return { kind: "oauth", provider, key };
  }
  return null;
}

function isCodexAgentProvider(provider: string): boolean {
  const normalized = provider.trim().toLowerCase();
  return normalized === "codex" || normalized === "codex-cli" || normalized === "codex-oauth";
}

function normalizeText(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text.length > 0 ? text : null;
}
