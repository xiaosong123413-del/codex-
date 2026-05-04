import type { Request, Response } from "express";
import fs from "node:fs";
import path from "node:path";
import type { ServerConfig } from "../config.js";
import {
  addConversationMessage,
  createConversation,
  deleteConversation,
  getConversation,
  listConversations,
  removeLastAssistantUserPair,
  updateConversation,
} from "../services/chat-store.js";
import { readAppConfig } from "../services/app-config.js";
import {
  generateAssistantReplyResult,
  streamAssistantReplyResult,
  type AssistantReplyResult,
} from "../services/llm-chat.js";
import { completeGuidedIngestFromConversation } from "../services/guided-ingest.js";
import { compile } from "../../../src/compiler/index.js";
import { generateIndex } from "../../../src/compiler/indexgen.js";
import { buildFrontmatter, slugify } from "../../../src/utils/markdown.js";

type ConversationMessageResult = NonNullable<ReturnType<typeof addConversationMessage>>;
type CreateConversationPayload = Parameters<typeof createConversation>[1];
type UpdateConversationPayload = Parameters<typeof updateConversation>[2];
type RequestBodyRecord = Record<string, unknown>;

interface IncomingChatMessage {
  content: string;
  articleRefs: string[];
}

interface PreparedConversationMessage {
  conversation: ConversationMessageResult;
  message: IncomingChatMessage;
}

const ASSISTANT_REPLY_PERSIST_ERROR = "assistant reply could not be persisted";

export function handleChatList(cfg: ServerConfig) {
  return (_req: Request, res: Response) => {
    res.json({ success: true, data: listConversations(chatStorageRoot(cfg)) });
  };
}

export function handleChatCreate(cfg: ServerConfig) {
  return (req: Request, res: Response) => {
    const conversation = createConversation(chatStorageRoot(cfg), readCreateConversationInput(cfg, req));
    res.status(201).json({ success: true, data: conversation });
  };
}

export function handleChatGet(cfg: ServerConfig) {
  return (req: Request, res: Response) => {
    const conversation = getConversation(chatStorageRoot(cfg), req.params.id);
    if (!conversation) {
      res.status(404).json({ success: false, error: "conversation not found" });
      return;
    }
    res.json({ success: true, data: conversation });
  };
}

export function handleChatPatch(cfg: ServerConfig) {
  return (req: Request, res: Response) => {
    const conversation = updateConversation(chatStorageRoot(cfg), req.params.id, readUpdateConversationInput(req));
    if (!conversation) {
      res.status(404).json({ success: false, error: "conversation not found" });
      return;
    }
    res.json({ success: true, data: conversation });
  };
}

export function handleChatDelete(cfg: ServerConfig) {
  return (req: Request, res: Response) => {
    const deleted = deleteConversation(chatStorageRoot(cfg), req.params.id);
    if (!deleted) {
      res.status(404).json({ success: false, error: "conversation not found" });
      return;
    }
    res.json({ success: true, data: { id: req.params.id } });
  };
}

export function handleChatAddMessage(cfg: ServerConfig) {
  return async (req: Request, res: Response) => {
    const prepared = prepareConversationMessage(cfg, req, res);
    if (!prepared) {
      return;
    }
    let conversation = prepared.conversation;

    try {
      const reply = await produceAssistantReply(cfg, conversation);
      conversation = persistAssistantReply(cfg, req.params.id, reply);
    } catch (error) {
      sendChatRouteError(res, error);
      return;
    }

    if (!conversation) {
      res.status(500).json({ success: false, error: ASSISTANT_REPLY_PERSIST_ERROR });
      return;
    }
    res.json({ success: true, data: conversation });
  };
}

export function handleChatStreamMessage(cfg: ServerConfig) {
  return async (req: Request, res: Response) => {
    const prepared = prepareConversationMessage(cfg, req, res);
    if (!prepared) {
      return;
    }
    let conversation = prepared.conversation;

    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    });
    writeSse(res, "user", { conversation });

    try {
      const reply = await produceAssistantReply(cfg, conversation, (token) => {
        writeSse(res, "token", { token });
      });
      conversation = persistAssistantReply(cfg, req.params.id, reply);
      if (!conversation) {
        writeStreamError(res, ASSISTANT_REPLY_PERSIST_ERROR);
        return;
      }
      writeStreamDone(res, conversation);
    } catch (error) {
      writeStreamError(res, error);
    } finally {
      res.end();
    }
  };
}

export function handleChatRegenerate(cfg: ServerConfig) {
  return async (req: Request, res: Response) => {
    const turn = removeLastAssistantUserPair(chatStorageRoot(cfg), req.params.id);
    if (!turn) {
      res.status(400).json({ success: false, error: "no assistant response to regenerate" });
      return;
    }
    const conversation = addConversationMessage(chatStorageRoot(cfg), req.params.id, {
      role: "user",
      content: turn.content,
      articleRefs: turn.articleRefs,
    });
    await completeConversationReply(cfg, req.params.id, conversation, res);
  };
}

export function handleChatSaveMessageToWiki(cfg: ServerConfig) {
  return async (req: Request, res: Response) => {
    const conversation = getConversation(chatStorageRoot(cfg), req.params.id);
    const message = conversation?.messages.find((item) => item.id === req.params.messageId);
    if (!conversation || !message || message.role !== "assistant") {
      res.status(404).json({ success: false, error: "assistant message not found" });
      return;
    }
    const saved = await saveAssistantMessageAsQuery(cfg.sourceVaultRoot, conversation.title, message.content);
    res.json({ success: true, data: saved });
  };
}

function prepareConversationMessage(
  cfg: ServerConfig,
  req: Request,
  res: Response,
): PreparedConversationMessage | null {
  const message = readIncomingChatMessage(req);
  if (!message) {
    res.status(400).json({ success: false, error: "content is required" });
    return null;
  }
  syncIncomingAgent(cfg, req);
  const conversation = addConversationMessage(chatStorageRoot(cfg), req.params.id, {
    role: "user",
    content: message.content,
    articleRefs: message.articleRefs,
  });
  if (!conversation) {
    res.status(404).json({ success: false, error: "conversation not found" });
    return null;
  }
  return { conversation, message };
}

async function completeConversationReply(
  cfg: ServerConfig,
  conversationId: string,
  conversation: ConversationMessageResult | null,
  res: Response,
): Promise<void> {
  if (!conversation) {
    res.status(404).json({ success: false, error: "conversation not found" });
    return;
  }
  try {
    const reply = await produceAssistantReply(cfg, conversation);
    sendPersistedConversation(res, persistAssistantReply(cfg, conversationId, reply));
  } catch (error) {
    sendChatRouteError(res, error);
  }
}

function readIncomingChatMessage(req: Request): IncomingChatMessage | null {
  const content = typeof req.body?.content === "string" ? req.body.content.trim() : "";
  if (!content) {
    return null;
  }
  return {
    content,
    articleRefs: Array.isArray(req.body?.articleRefs) ? req.body.articleRefs : [],
  };
}

function readCreateConversationInput(cfg: ServerConfig, req: Request): CreateConversationPayload {
  const body = readRequestBody(req.body);
  const requestedAppId = readRequestedAppId(body);
  const defaultAppId = readAppConfig(cfg.projectRoot).defaultAppId;
  return {
    title: readOptionalString(body, "title"),
    webSearchEnabled: readOptionalBoolean(body, "webSearchEnabled"),
    searchScope: normalizeSearchScope(body?.searchScope),
    appId: requestedAppId === undefined ? defaultAppId ?? undefined : requestedAppId,
    articleRefs: readOptionalStringArray(body, "articleRefs"),
    maxHistoryMessages: readOptionalNumber(body, "maxHistoryMessages"),
  };
}

function readUpdateConversationInput(req: Request): UpdateConversationPayload {
  const body = readRequestBody(req.body);
  return {
    title: readOptionalString(body, "title"),
    webSearchEnabled: readOptionalBoolean(body, "webSearchEnabled"),
    searchScope: normalizeSearchScope(body?.searchScope),
    appId: readRequestedAppId(body),
    articleRefs: readOptionalStringArray(body, "articleRefs"),
    maxHistoryMessages: readOptionalNumber(body, "maxHistoryMessages"),
  };
}

async function produceAssistantReply(
  cfg: ServerConfig,
  conversation: ConversationMessageResult,
  onToken?: (token: string) => void,
): Promise<AssistantReplyResult> {
  const guided = completeGuidedIngestFromConversation(cfg.sourceVaultRoot, conversation);
  if (guided) {
    return { content: buildGuidedIngestReply(guided.createdPage), references: [] };
  }
  if (onToken) {
    return streamAssistantReplyResult(cfg.sourceVaultRoot, conversation, chatOptions(cfg), onToken);
  }
  return generateAssistantReplyResult(cfg.sourceVaultRoot, conversation, chatOptions(cfg));
}

function chatOptions(cfg: ServerConfig): { projectRoot: string; serverConfig: ServerConfig } {
  const options = { projectRoot: cfg.projectRoot } as { projectRoot: string; serverConfig: ServerConfig };
  Object.defineProperty(options, "serverConfig", { value: cfg, enumerable: false });
  return options;
}

function writeSse(res: Response, event: string, payload: unknown): void {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function writeStreamDone(res: Response, conversation: ConversationMessageResult): void {
  writeSse(res, "done", { conversation });
}

function writeStreamError(res: Response, error: unknown): void {
  writeSse(res, "error", {
    error: error instanceof Error ? error.message : String(error),
  });
}

function persistAssistantReply(cfg: ServerConfig, conversationId: string, reply: AssistantReplyResult) {
  return addConversationMessage(chatStorageRoot(cfg), conversationId, {
    role: "assistant",
    content: normalizeAssistantReply(reply.content),
    references: reply.references,
  });
}

function sendPersistedConversation(res: Response, conversation: ConversationMessageResult | null): void {
  if (!conversation) {
    res.status(500).json({ success: false, error: ASSISTANT_REPLY_PERSIST_ERROR });
    return;
  }
  res.json({ success: true, data: conversation });
}

async function saveAssistantMessageAsQuery(
  wikiRoot: string,
  conversationTitle: string,
  content: string,
): Promise<{ path: string; autoIngest: { sourcePath: string; compiled: boolean; error?: string } }> {
  const title = readQueryTitle(conversationTitle, content);
  const filePath = uniqueQueryFilePath(wikiRoot, title);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const document = `${buildQueryDocument(title, content)}\n`;
  fs.writeFileSync(filePath, document);
  await generateIndex(wikiRoot);
  const autoIngest = await autoIngestSavedQuery(wikiRoot, filePath, document);
  return { path: path.relative(wikiRoot, filePath).replace(/\\/g, "/"), autoIngest };
}

function readQueryTitle(conversationTitle: string, content: string): string {
  const firstLine = content.split(/\r?\n/).find((line) => line.trim()) ?? "";
  const title = firstLine.replace(/^#+\s*/, "").trim() || conversationTitle;
  return title.slice(0, 80) || "Saved Query";
}

function uniqueQueryFilePath(wikiRoot: string, title: string): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const slug = slugify(title).slice(0, 80) || "saved-query";
  return path.join(wikiRoot, "wiki", "queries", `${slug}-${stamp}.md`);
}

function buildQueryDocument(title: string, content: string): string {
  const frontmatter = buildFrontmatter({
    type: "query",
    title,
    created: new Date().toISOString(),
  });
  return `${frontmatter}\n\n${stripHiddenChatBlocks(content).trimEnd()}`;
}

function stripHiddenChatBlocks(content: string): string {
  return content
    .replace(/<!--.*?-->/gs, "")
    .replace(/<think(?:ing)?>\s*[\s\S]*?<\/think(?:ing)?>\s*/gi, "")
    .replace(/<think(?:ing)?>\s*[\s\S]*$/gi, "");
}

async function autoIngestSavedQuery(
  wikiRoot: string,
  queryFilePath: string,
  document: string,
): Promise<{ sourcePath: string; compiled: boolean; error?: string }> {
  const sourcePath = savedQuerySourcePath(wikiRoot, queryFilePath);
  fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
  fs.writeFileSync(sourcePath, document);
  try {
    await compile(wikiRoot);
    return { sourcePath: path.relative(wikiRoot, sourcePath).replace(/\\/g, "/"), compiled: true };
  } catch (error) {
    return {
      sourcePath: path.relative(wikiRoot, sourcePath).replace(/\\/g, "/"),
      compiled: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function savedQuerySourcePath(wikiRoot: string, queryFilePath: string): string {
  return path.join(wikiRoot, "sources", "saved-queries", path.basename(queryFilePath));
}

function buildGuidedIngestReply(createdPage: string): string {
  return `\u5df2\u5b8c\u6210\u4eb2\u81ea\u6307\u5bfc\u5f55\u5165\uff1a${createdPage}\n\n\u4e0b\u4e00\u6b65\u53ef\u4ee5\u8fd0\u884c\u540c\u6b65\u7f16\u8bd1\uff0c\u91cd\u5efa index / MOC / log\u3002`;
}

function normalizeAssistantReply(reply: string): string {
  return reply.trim() || "\u62b1\u6b49\uff0c\u8fd9\u4e00\u8f6e\u6ca1\u6709\u751f\u6210\u6709\u6548\u56de\u7b54\u3002";
}

function sendChatRouteError(res: Response, error: unknown): void {
  res.status(502).json({
    success: false,
    error: error instanceof Error ? error.message : String(error),
  });
}

function normalizeSearchScope(value: unknown): "local" | "web" | "all" | undefined {
  return value === "web" || value === "all" || value === "local" ? value : undefined;
}

function normalizeAppId(value: unknown): string | null | undefined {
  if (value === null) return null;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readRequestBody(value: unknown): RequestBodyRecord | null {
  return value && typeof value === "object" ? value as RequestBodyRecord : null;
}

function readOptionalString(body: RequestBodyRecord | null, key: string): string | undefined {
  return typeof body?.[key] === "string" ? body[key] as string : undefined;
}

function readOptionalBoolean(body: RequestBodyRecord | null, key: string): boolean | undefined {
  return typeof body?.[key] === "boolean" ? body[key] as boolean : undefined;
}

function readOptionalNumber(body: RequestBodyRecord | null, key: string): number | undefined {
  return typeof body?.[key] === "number" ? body[key] as number : undefined;
}

function readOptionalStringArray(body: RequestBodyRecord | null, key: string): string[] | undefined {
  const value = body?.[key];
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.filter((item): item is string => typeof item === "string");
}

function readRequestedAppId(body: RequestBodyRecord | null): string | null | undefined {
  if (!body) {
    return undefined;
  }
  if (Object.prototype.hasOwnProperty.call(body, "appId")) {
    return normalizeAppId(body.appId);
  }
  if (Object.prototype.hasOwnProperty.call(body, "agentId")) {
    return normalizeAppId(body.agentId);
  }
  return undefined;
}

function syncIncomingAgent(cfg: ServerConfig, req: Request): void {
  const appId = readRequestedAppId(readRequestBody(req.body));
  if (appId !== undefined) {
    updateConversation(chatStorageRoot(cfg), req.params.id, { appId });
  }
}

function chatStorageRoot(cfg: ServerConfig): string {
  return cfg.sourceVaultRoot;
}
