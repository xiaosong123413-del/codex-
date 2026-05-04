/**
 * Cloudflare Worker remote MCP gateway for LLM Wiki.
 *
 * This Worker makes the old standalone ai-native CLI idea an in-repo,
 * Cloudflare-hosted entry point. Codex talks to `/mcp` as a remote MCP server,
 * while OpenClaw can forward personal WeChat messages into the same tools.
 *
 * Runtime boundaries are explicit: Worker-safe wiki read/chat operations can
 * run on Cloudflare bindings or proxy the existing remote-brain Worker; local
 * filesystem CLI actions are forwarded to a local bridge URL because Workers
 * cannot spawn local processes or access a desktop workspace.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMcpHandler } from "agents/mcp";
import { z } from "zod";

const DEFAULT_SEARCH_LIMIT = 8;
const MAX_SEARCH_LIMIT = 20;
const REMOTE_TIMEOUT_MS = 30_000;

type ChatMode = "wiki" | "web" | "hybrid";
type CliCommand = "ingest" | "compile" | "query" | "lint" | "watch" | "webui";

interface Env {
  readonly AI?: Ai;
  readonly DB?: D1Database;
  readonly LLM_MODEL?: string;
  readonly LLMWIKI_LOCAL_BRIDGE_URL?: string;
  readonly LLMWIKI_MCP_SHARED_SECRET?: string;
  readonly LLMWIKI_OWNER_UID?: string;
  readonly LLMWIKI_REMOTE_BRAIN_URL?: string;
  readonly LLMWIKI_REMOTE_TOKEN?: string;
  readonly LLMWIKI_WEBUI_URL?: string;
}

interface SearchRow {
  readonly path: string;
  readonly title: string;
  readonly excerpt?: string;
}

interface CliJob {
  readonly command: CliCommand;
  readonly args?: Record<string, unknown>;
}

interface WeChatMessage {
  readonly text: string;
  readonly ownerUid?: string;
}

interface ToolContent {
  type: "text";
  text: string;
}

interface ToolResult {
  [key: string]: unknown;
  content: ToolContent[];
  isError?: boolean;
}

type RouteHandler = (request: Request) => Promise<Response> | Response;

/** Worker module entry. */
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method === "OPTIONS") return corsResponse();
    const handler = routeHandlers(env, ctx).get(new URL(request.url).pathname);
    return handler ? handler(request) : json({ ok: false, error: "not_found" }, 404);
  },
};

function routeHandlers(env: Env, ctx: ExecutionContext): Map<string, RouteHandler> {
  return new Map([
    ["/status", () => json(statusPayload(env))],
    ["/mcp", (request: Request) => handleMcpRequest(request, env, ctx)],
  ]);
}

function handleMcpRequest(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> | Response {
  const authError = authorizeMcpRequest(request, env);
  if (authError) return authError;
  return createMcpHandler(createServer(env), { route: "/mcp" })(request, env, ctx);
}

function createServer(env: Env): McpServer {
  const server = new McpServer({ name: "llmwiki-ai-native", version: "0.1.0" });
  registerStatusTool(server, env);
  registerWikiTools(server, env);
  registerChatTool(server, env);
  registerCliTool(server, env);
  registerWebuiTool(server, env);
  registerWeChatTool(server, env);
  return server;
}

function registerStatusTool(server: McpServer, env: Env): void {
  server.tool("llmwiki_status", "Show Worker, remote brain, and WebUI wiring.", {}, async () => textResult(statusPayload(env)));
}

function registerWikiTools(server: McpServer, env: Env): void {
  server.tool(
    "llmwiki_search_wiki",
    "Search published LLM Wiki pages.",
    { query: z.string(), limit: z.number().int().min(1).max(MAX_SEARCH_LIMIT).optional() },
    async ({ query, limit }) => textResult(await searchWiki(env, query, limit)),
  );
  server.tool(
    "llmwiki_get_page",
    "Read one published LLM Wiki page by path.",
    { path: z.string() },
    async ({ path }) => textResult(await getPage(env, path)),
  );
}

function registerChatTool(server: McpServer, env: Env): void {
  server.tool(
    "llmwiki_chat",
    "Ask LLM Wiki using wiki, web, or hybrid mode.",
    {
      message: z.string(),
      mode: z.enum(["wiki", "web", "hybrid"]).optional(),
      ownerUid: z.string().optional(),
      chatId: z.string().optional(),
    },
    async (args) => textResult(await chat(env, args.message, args.mode ?? "hybrid", args.ownerUid, args.chatId)),
  );
}

function registerCliTool(server: McpServer, env: Env): void {
  server.tool(
    "llmwiki_run_cli",
    "Forward one LLM Wiki CLI command to the configured local bridge.",
    {
      command: z.enum(["ingest", "compile", "query", "lint", "watch", "webui"]),
      args: z.record(z.string(), z.unknown()).optional(),
    },
    async (job) => runCli(env, job),
  );
}

function registerWebuiTool(server: McpServer, env: Env): void {
  server.tool("llmwiki_webui", "Return the configured WebUI and MCP entry URLs.", {}, async () => textResult({
    webuiUrl: env.LLMWIKI_WEBUI_URL ?? null,
    remoteBrainUrl: env.LLMWIKI_REMOTE_BRAIN_URL ?? null,
    requiresWebuiUrl: !env.LLMWIKI_WEBUI_URL,
  }));
}

function registerWeChatTool(server: McpServer, env: Env): void {
  server.tool(
    "llmwiki_wechat_message",
    "Route one OpenClaw personal WeChat text message into LLM Wiki.",
    { text: z.string(), ownerUid: z.string().optional() },
    async (message) => handleWeChatMessage(env, message),
  );
}

function authorizeMcpRequest(request: Request, env: Env): Response | null {
  if (!env.LLMWIKI_MCP_SHARED_SECRET) return null;
  const expected = `Bearer ${env.LLMWIKI_MCP_SHARED_SECRET}`;
  if (request.headers.get("authorization") === expected) return null;
  return json({ ok: false, error: "unauthorized" }, 401);
}

function statusPayload(env: Env): Record<string, unknown> {
  return {
    ok: true,
    service: "llmwiki-ai-native-mcp-worker",
    bindings: { ai: Boolean(env.AI), db: Boolean(env.DB) },
    remoteBrainConfigured: Boolean(env.LLMWIKI_REMOTE_BRAIN_URL),
    localBridgeConfigured: Boolean(env.LLMWIKI_LOCAL_BRIDGE_URL),
    webuiConfigured: Boolean(env.LLMWIKI_WEBUI_URL),
    ownerUidConfigured: Boolean(env.LLMWIKI_OWNER_UID),
  };
}

async function searchWiki(env: Env, query: string, limit?: number): Promise<unknown> {
  const normalizedLimit = clampLimit(limit);
  if (env.LLMWIKI_REMOTE_BRAIN_URL) {
    return callRemoteBrain(env, "/search", { query, limit: normalizedLimit });
  }
  if (!env.DB) return errorPayload("missing_search_backend");
  return searchWikiFromD1(env.DB, query, normalizedLimit);
}

async function getPage(env: Env, path: string): Promise<unknown> {
  if (env.LLMWIKI_REMOTE_BRAIN_URL) {
    return callRemoteBrain(env, "/mcp", {
      jsonrpc: "2.0",
      id: "get-page",
      method: "tools/call",
      params: { name: "get_page", arguments: { path } },
    });
  }
  if (!env.DB) return errorPayload("missing_page_backend");
  return getPageFromD1(env.DB, path);
}

async function chat(env: Env, message: string, mode: ChatMode, ownerUid?: string, chatId?: string): Promise<unknown> {
  if (env.LLMWIKI_REMOTE_BRAIN_URL) return chatViaRemoteBrain(env, message, mode, ownerUid, chatId);
  return chatViaWorkersAi(env, message, mode);
}

async function chatViaRemoteBrain(env: Env, message: string, mode: ChatMode, ownerUid?: string, chatId?: string): Promise<unknown> {
  const uid = ownerUid ?? env.LLMWIKI_OWNER_UID;
  if (!uid) return errorPayload("missing_owner_uid");
  return callRemoteBrain(env, "/mobile/chat/send", { ownerUid: uid, chatId, message, mode });
}

async function chatViaWorkersAi(env: Env, message: string, mode: ChatMode): Promise<unknown> {
  if (!env.AI) return errorPayload("missing_chat_backend");
  const context = env.DB ? await searchWikiFromD1(env.DB, message, 5) : { results: [] };
  return callWorkersAi(env, message, mode, context);
}

async function runCli(env: Env, job: CliJob): Promise<ToolResult> {
  if (!env.LLMWIKI_LOCAL_BRIDGE_URL) {
    return textResult(errorPayload("missing_local_bridge", "Cloudflare Workers cannot execute local CLI commands."));
  }
  const result = await postJson(env.LLMWIKI_LOCAL_BRIDGE_URL, "/cli/run", job, env.LLMWIKI_REMOTE_TOKEN);
  return textResult(result);
}

async function handleWeChatMessage(env: Env, message: WeChatMessage): Promise<ToolResult> {
  const text = message.text.trim();
  if (!text) return textResult(errorPayload("missing_wechat_text"));
  const cliJob = parseWeChatCliJob(text);
  if (cliJob) return runCli(env, cliJob);
  return textResult(await chat(env, text, "hybrid", message.ownerUid));
}

function parseWeChatCliJob(text: string): CliJob | null {
  const exactJob = exactWeChatCliJobs().get(text);
  if (exactJob) return exactJob;
  return prefixedWeChatCliJobs(text);
}

function exactWeChatCliJobs(): Map<string, CliJob> {
  return new Map([
    ["/compile", { command: "compile" }],
    ["/lint", { command: "lint" }],
    ["/webui", { command: "webui" }],
  ]);
}

function prefixedWeChatCliJobs(text: string): CliJob | null {
  const commands: Array<[string, CliJob["command"], string]> = [
    ["/query ", "query", "question"],
    ["/ingest ", "ingest", "source"],
  ];
  const match = commands.find(([prefix]) => text.startsWith(prefix));
  return match ? { command: match[1], args: { [match[2]]: text.slice(match[0].length).trim() } } : null;
}

async function searchWikiFromD1(db: D1Database, query: string, limit: number): Promise<unknown> {
  const likeQuery = `%${query}%`;
  const result = await db.prepare(
    "SELECT path, title, substr(content, 1, 500) AS excerpt FROM wiki_pages WHERE title LIKE ? OR content LIKE ? ORDER BY published_at DESC LIMIT ?",
  ).bind(likeQuery, likeQuery, limit).all<SearchRow>();
  return { ok: true, results: result.results ?? [] };
}

async function getPageFromD1(db: D1Database, path: string): Promise<unknown> {
  const page = await db.prepare(
    "SELECT path, title, content FROM wiki_pages WHERE path = ?",
  ).bind(path).first();
  if (!page) return errorPayload("page_not_found");
  return { ok: true, page };
}

async function callWorkersAi(env: Env, message: string, mode: ChatMode, context: unknown): Promise<unknown> {
  const prompt = [
    `Mode: ${mode}`,
    "Use the LLM Wiki context when it is relevant.",
    JSON.stringify(context),
    `Question: ${message}`,
  ].join("\n\n");
  const model = env.LLM_MODEL ?? "@cf/meta/llama-3.1-8b-instruct";
  const result = await env.AI?.run(model, { prompt });
  return { ok: true, model, result };
}

async function callRemoteBrain(env: Env, path: string, payload: unknown): Promise<unknown> {
  if (!env.LLMWIKI_REMOTE_BRAIN_URL) return errorPayload("missing_remote_brain_url");
  return postJson(env.LLMWIKI_REMOTE_BRAIN_URL, path, payload, env.LLMWIKI_REMOTE_TOKEN);
}

async function postJson(baseUrl: string, path: string, payload: unknown, token?: string): Promise<unknown> {
  const url = new URL(path, ensureTrailingSlash(baseUrl));
  const response = await fetchWithTimeout(url, {
    method: "POST",
    headers: jsonHeaders(token),
    body: JSON.stringify(payload),
  });
  return readJsonResponse(response);
}

async function fetchWithTimeout(url: URL, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REMOTE_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function readJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  const data = text ? JSON.parse(text) as unknown : null;
  if (response.ok) return data;
  return { ok: false, status: response.status, data };
}

function jsonHeaders(token?: string): HeadersInit {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  return headers;
}

function clampLimit(limit?: number): number {
  if (!Number.isFinite(limit)) return DEFAULT_SEARCH_LIMIT;
  return Math.min(Math.max(Math.trunc(limit ?? DEFAULT_SEARCH_LIMIT), 1), MAX_SEARCH_LIMIT);
}

function ensureTrailingSlash(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}

function errorPayload(error: string, detail?: string): Record<string, unknown> {
  return { ok: false, error, detail };
}

function textResult(value: unknown): ToolResult {
  return { content: [{ type: "text", text: stringify(value) }] };
}

function stringify(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders() },
  });
}

function corsResponse(): Response {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

function corsHeaders(): Record<string, string> {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "authorization,content-type,mcp-session-id",
    "access-control-expose-headers": "mcp-session-id",
  };
}
