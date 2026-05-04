import fs from "node:fs";
import path from "node:path";
import type { ServerConfig } from "../config.js";
import { searchAll } from "./search-orchestrator.js";
import type { SearchResult } from "./search-router.js";
import type { ChatMessageReference, Conversation } from "./chat-store.js";
import type { LLMMessage, LLMProvider } from "../../../src/utils/provider.js";
import type { WebSearchResult } from "../../../src/services/cloudflare-web-search.js";
import { readAgentConfig, type AgentDefinition } from "./agent-config.js";
import { resolveAgentRuntimeProvider } from "./llm-agent-provider.js";
import { extractMarkdownImages } from "./markdown-images.js";
import { expandSearchResultsWithGraph } from "./search-graph-expansion.js";
import { computeContextBudget } from "./chat-context-budget.js";

const MAX_TOKENS = 4000;
const MAX_REFERENCED_SEARCH_RESULTS = 8;
const DEFAULT_HISTORY_MESSAGES = 10;

export {
  resolveAgentRuntimeProvider,
  resolveCodexAgentProviderRoute,
} from "./llm-agent-provider.js";

interface LlmChatOptions {
  projectRoot?: string;
  serverConfig?: ServerConfig;
  provider?: LLMProvider;
}

export interface AssistantReplyResult {
  content: string;
  references: ChatMessageReference[];
}

export async function generateAssistantReply(
  wikiRoot: string,
  conversation: Conversation,
  providerOrOptions: LLMProvider | LlmChatOptions = {},
): Promise<string> {
  return (await generateAssistantReplyResult(wikiRoot, conversation, providerOrOptions)).content;
}

export async function generateAssistantReplyResult(
  wikiRoot: string,
  conversation: Conversation,
  providerOrOptions: LLMProvider | LlmChatOptions = {},
): Promise<AssistantReplyResult> {
  const options = normalizeChatOptions(providerOrOptions);
  const agent = resolveConversationAgent(options.projectRoot ?? wikiRoot, conversation);
  const provider = options.provider ?? resolveConversationProvider(options.projectRoot ?? wikiRoot, conversation, agent);
  const context = await buildReplyContext(wikiRoot, conversation, agent, options.serverConfig);
  return {
    content: await provider.complete(context.system, toProviderMessages(conversation), MAX_TOKENS),
    references: context.references,
  };
}

export async function streamAssistantReply(
  wikiRoot: string,
  conversation: Conversation,
  providerOrOptions: LLMProvider | LlmChatOptions = {},
  onToken?: (token: string) => void,
): Promise<string> {
  return (await streamAssistantReplyResult(wikiRoot, conversation, providerOrOptions, onToken)).content;
}

export async function streamAssistantReplyResult(
  wikiRoot: string,
  conversation: Conversation,
  providerOrOptions: LLMProvider | LlmChatOptions = {},
  onToken?: (token: string) => void,
): Promise<AssistantReplyResult> {
  const options = normalizeChatOptions(providerOrOptions);
  const agent = resolveConversationAgent(options.projectRoot ?? wikiRoot, conversation);
  const provider = options.provider ?? resolveConversationProvider(options.projectRoot ?? wikiRoot, conversation, agent);
  const context = await buildReplyContext(wikiRoot, conversation, agent, options.serverConfig);
  return {
    content: await provider.stream(context.system, toProviderMessages(conversation), MAX_TOKENS, onToken),
    references: context.references,
  };
}

function normalizeChatOptions(input: LLMProvider | LlmChatOptions): LlmChatOptions {
  if (isProviderLike(input)) {
    return { provider: input };
  }
  return input;
}

function isProviderLike(value: LLMProvider | LlmChatOptions): value is LLMProvider {
  return typeof (value as Partial<LLMProvider>).complete === "function"
    || typeof (value as Partial<LLMProvider>).stream === "function";
}

function resolveConversationAgent(projectRoot: string, conversation: Conversation): AgentDefinition | null {
  const config = readAgentConfig(projectRoot);
  const agentId = conversation.appId ?? conversation.agentId ?? config.activeAgentId;
  if (!agentId) return null;
  return config.agents.find((agent) => agent.id === agentId && agent.enabled) ?? null;
}

function resolveConversationProvider(projectRoot: string, conversation: Conversation, agent: AgentDefinition | null): LLMProvider {
  return resolveAgentRuntimeProvider(projectRoot, agent, `conversation:${conversation.id}`);
}

async function buildReplyContext(
  wikiRoot: string,
  conversation: Conversation,
  agent: AgentDefinition | null,
  cfg?: ServerConfig,
): Promise<{ system: string; references: ChatMessageReference[] }> {
  const budget = computeContextBudget(undefined);
  const sections: string[] = [
    "You are LLM Wiki, a personal knowledge assistant.",
    "Use the user's working language for every visible section, including <thinking>. If the user writes Chinese, answer in Chinese unless explicitly asked otherwise.",
    "Ground claims in the provided wiki, source context, and search results.",
    "If both local wiki and web search are available, clearly separate 哪些信息来自本地 wiki，哪些来自联网结果。",
    "Start with <thinking>...</thinking> containing only a concise reasoning summary in the user's working language. If the user writes Chinese, the thinking summary must be Chinese. Keep it to 3-5 short lines; do not include hidden chain-of-thought or English planning notes.",
    "When using a listed source, cite it inline as [1], [2], etc.",
    "At the end, add one hidden HTML comment exactly like <!-- cited: 1, 3 --> with the source numbers you actually used.",
  ];
  const purpose = readOptionalPage(wikiRoot, "wiki/purpose.md", 3000);
  if (purpose) sections.push(`<wiki_purpose>\n${purpose}\n</wiki_purpose>`);

  appendAgentConfig(sections, agent);
  const searchContext = await loadSearchContext(conversation, cfg);
  const references = buildReferences(wikiRoot, conversation.articleRefs, searchContext.localResults, searchContext.webResults);
  appendRetrievalContext(sections, wikiRoot, references, searchContext, budget);

  return {
    system: sections.join("\n\n"),
    references,
  };
}

function appendAgentConfig(sections: string[], agent: AgentDefinition | null): void {
  if (!agent) return;
  sections.push("<agent_config>");
  sections.push([
    `name: ${agent.name}`,
    agent.purpose ? `purpose: ${agent.purpose}` : "",
    agent.workflow ? `workflow:\n${agent.workflow}` : "",
    agent.prompt ? `prompt:\n${agent.prompt}` : "",
  ].filter(Boolean).join("\n\n"));
  sections.push("</agent_config>");
}

function appendRetrievalContext(
  sections: string[],
  wikiRoot: string,
  references: ChatMessageReference[],
  searchContext: { web: string },
  budget: ReturnType<typeof computeContextBudget>,
): void {
  if (references.length) sections.push(`<source_list>\n${formatSourceList(references)}\n</source_list>`);
  const index = readOptionalPage(wikiRoot, "wiki/index.md", budget.indexBudget);
  if (index) sections.push(`<wiki_index>\n${index}\n</wiki_index>`);
  const wikiPages = formatWikiPages(wikiRoot, references, budget.pageBudget, budget.maxPageSize);
  if (wikiPages) sections.push(`<wiki_pages>\n${wikiPages}\n</wiki_pages>`);
  if (searchContext.web) sections.push(`<web_search_results>\n${searchContext.web}\n</web_search_results>`);
}

function toProviderMessages(conversation: Conversation): LLMMessage[] {
  return conversation.messages
    .filter((message): message is Conversation["messages"][number] & { role: "user" | "assistant" } =>
      message.role === "user" || message.role === "assistant")
    .slice(-readHistoryDepth(conversation.maxHistoryMessages))
    .map((message) => ({
      role: message.role,
      content: message.content,
    }));
}

function readHistoryDepth(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : DEFAULT_HISTORY_MESSAGES;
}

async function loadSearchContext(
  conversation: Conversation,
  cfg?: ServerConfig,
): Promise<{ localResults: SearchResult[]; webResults: WebSearchResult[]; web: string }> {
  const latestUserMessage = [...conversation.messages]
    .reverse()
    .find((message) => message.role === "user" && message.content.trim());
  if (!latestUserMessage) {
    return { localResults: [], webResults: [], web: "" };
  }

  const scope = normalizeConversationScope(conversation);
  const result = await searchAll(cfg, latestUserMessage.content, {
    scope,
    mode: scope === "web" ? "keyword" : "hybrid",
    webLimit: 5,
  });
  const localResults = expandSearchResultsWithGraph(cfg, result.local.results);

  return {
    localResults: localResults.slice(0, MAX_REFERENCED_SEARCH_RESULTS),
    webResults: result.web.results.slice(0, MAX_REFERENCED_SEARCH_RESULTS),
    web: formatWebSearchResults(result.web.results),
  };
}

function normalizeConversationScope(conversation: Conversation): "local" | "web" | "all" {
  if (conversation.searchScope === "all" || conversation.searchScope === "web" || conversation.searchScope === "local") {
    return conversation.searchScope;
  }
  return conversation.webSearchEnabled ? "web" : "local";
}

function formatWebSearchResults(results: WebSearchResult[]): string {
  if (results.length === 0) {
    return "";
  }
  return results.slice(0, 8).map((result, index) => [
    `${index + 1}. ${result.title}`,
    `url: ${result.url}`,
    `snippet: ${truncate(result.snippet, 320)}`,
  ].join("\n")).join("\n\n");
}

function buildReferences(
  wikiRoot: string,
  articleRefs: string[],
  localResults: SearchResult[],
  webResults: WebSearchResult[],
): ChatMessageReference[] {
  const references: ChatMessageReference[] = [];
  const seen = new Set<string>();
  addArticleReferences(references, seen, wikiRoot, articleRefs);
  addLocalSearchReferences(references, seen, localResults);
  addWebSearchReferences(references, seen, webResults);
  return references;
}

function addArticleReferences(
  references: ChatMessageReference[],
  seen: Set<string>,
  wikiRoot: string,
  articleRefs: string[],
): void {
  for (const ref of articleRefs) {
    const normalizedPath = normalizeReferencePath(ref);
    if (!normalizedPath || seen.has(`wiki:${normalizedPath}`)) {
      continue;
    }
    seen.add(`wiki:${normalizedPath}`);
    references.push({
      index: references.length + 1,
      kind: "wiki",
      title: readPageTitle(wikiRoot, normalizedPath),
      path: normalizedPath,
      excerpt: readPageExcerpt(wikiRoot, normalizedPath),
      images: readPageImages(wikiRoot, normalizedPath),
    });
  }
}

function addLocalSearchReferences(
  references: ChatMessageReference[],
  seen: Set<string>,
  localResults: SearchResult[],
): void {
  for (const result of localResults) {
    const normalizedPath = normalizeReferencePath(result.path);
    if (!normalizedPath || seen.has(`wiki:${normalizedPath}`)) {
      continue;
    }
    seen.add(`wiki:${normalizedPath}`);
    references.push({
      index: references.length + 1,
      kind: "wiki",
      title: result.title,
      path: normalizedPath,
      excerpt: result.excerpt,
      images: result.images,
    });
  }
}

function addWebSearchReferences(
  references: ChatMessageReference[],
  seen: Set<string>,
  webResults: WebSearchResult[],
): void {
  for (const result of webResults) {
    if (!result.url || seen.has(`web:${result.url}`)) {
      continue;
    }
    seen.add(`web:${result.url}`);
    references.push({
      index: references.length + 1,
      kind: "web",
      title: result.title,
      url: result.url,
      excerpt: result.snippet,
    });
  }
}

function formatSourceList(references: ChatMessageReference[]): string {
  return references.map((reference) => {
    const location = reference.kind === "web" ? reference.url : reference.path;
    return `[${reference.index}] ${reference.title}\nkind: ${reference.kind}\nsource: ${location}`;
  }).join("\n\n");
}

function formatWikiPages(
  wikiRoot: string,
  references: ChatMessageReference[],
  pageBudget: number,
  maxPageSize: number,
): string {
  const pages: string[] = [];
  let used = 0;
  for (const reference of references.filter((item) => item.kind === "wiki" && item.path)) {
    const page = formatWikiPage(wikiRoot, reference, maxPageSize);
    if (!page || used + page.length > pageBudget) continue;
    pages.push(page);
    used += page.length;
  }
  return pages.join("\n\n---\n\n");
}

function formatWikiPage(wikiRoot: string, reference: ChatMessageReference, maxPageSize: number): string {
  const content = reference.path ? readPageContent(wikiRoot, reference.path) : "";
  const body = content || reference.excerpt;
  if (!body) {
    return "";
  }
  return [
    `### [${reference.index}] ${reference.title}`,
    `path: ${reference.path}`,
    "",
    truncate(body, maxPageSize),
  ].join("\n");
}

function readOptionalPage(wikiRoot: string, pagePath: string, maxChars: number): string {
  return truncate(readPageContent(wikiRoot, pagePath), maxChars);
}

function readPageTitle(wikiRoot: string, pagePath: string): string {
  const content = readPageContent(wikiRoot, pagePath);
  const heading = content.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return heading || path.basename(pagePath, path.extname(pagePath));
}

function readPageExcerpt(wikiRoot: string, pagePath: string): string {
  return truncate(readPageContent(wikiRoot, pagePath).replace(/\s+/g, " ").trim(), 320);
}

function readPageImages(wikiRoot: string, pagePath: string): ChatMessageReference["images"] {
  return extractMarkdownImages(readPageContent(wikiRoot, pagePath));
}

function readPageContent(wikiRoot: string, pagePath: string): string {
  const filePath = path.join(wikiRoot, pagePath);
  if (!fs.existsSync(filePath)) {
    return "";
  }
  return fs.readFileSync(filePath, "utf8").trim();
}

function normalizeReferencePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\/+/, "").trim();
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, maxChars)}...`;
}
