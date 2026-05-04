/**
 * File-backed chat conversation storage for the desktop/web chat surface.
 *
 * Conversations are stored without a database. Metadata lives in
 * `.llm-wiki/conversations.json`, while each message thread lives in
 * `.llm-wiki/chats/{conversationId}.json`. The reader also accepts the older
 * `.chat/{id}.json` layout so existing local workspaces continue to open.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
  articleRefs?: string[];
  references?: ChatMessageReference[];
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  webSearchEnabled: boolean;
  searchScope: "local" | "web" | "all";
  appId?: string | null;
  agentId?: string | null;
  articleRefs: string[];
  maxHistoryMessages: number;
  messages: ChatMessage[];
}

export interface ChatMessageReference {
  index: number;
  kind: "wiki" | "web";
  title: string;
  path?: string;
  url?: string;
  excerpt: string;
  images?: ChatMessageReferenceImage[];
}

interface ChatMessageReferenceImage {
  alt: string;
  url: string;
}

interface ConversationSummary {
  id: string;
  title: string;
  updatedAt: string;
  latestMessage: string;
}

interface CreateConversationInput {
  title?: string;
  webSearchEnabled?: boolean;
  searchScope?: Conversation["searchScope"];
  appId?: string | null;
  agentId?: string | null;
  articleRefs?: string[];
  maxHistoryMessages?: number;
}

interface UpdateConversationInput {
  title?: string;
  webSearchEnabled?: boolean;
  searchScope?: Conversation["searchScope"];
  appId?: string | null;
  agentId?: string | null;
  articleRefs?: string[];
  maxHistoryMessages?: number;
}

interface AddMessageInput {
  role: ChatMessage["role"];
  content: string;
  articleRefs?: string[];
  references?: ChatMessageReference[];
}

interface RegenerateConversationTurn {
  conversation: Conversation;
  content: string;
  articleRefs: string[];
}

const CHAT_HISTORY_DIR = ".llm-wiki";
const CHAT_MESSAGES_DIR = "chats";
const CONVERSATION_INDEX_FILE = "conversations.json";
const LEGACY_CHAT_DIR = ".chat";
const MAX_STORED_MESSAGES = 100;
const DEFAULT_HISTORY_MESSAGES = 10;
const NEW_CONVERSATION_TITLE = "新对话";

export function listConversations(root: string): ConversationSummary[] {
  return readConversationIndex(root)
    .map((metadata) => readConversationFromMetadata(root, metadata))
    .filter((conversation): conversation is Conversation => conversation !== null)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map((conversation) => ({
      id: conversation.id,
      title: conversation.title,
      updatedAt: conversation.updatedAt,
      latestMessage: conversation.messages.at(-1)?.content ?? "",
    }));
}

export function createConversation(root: string, input: CreateConversationInput = {}): Conversation {
  const now = new Date().toISOString();
  const conversation: Conversation = {
    id: crypto.randomUUID(),
    title: input.title?.trim() || "\u65b0\u5bf9\u8bdd",
    createdAt: now,
    updatedAt: now,
    webSearchEnabled: input.webSearchEnabled ?? false,
    searchScope: normalizeSearchScope(input.searchScope, input.webSearchEnabled),
    appId: normalizeAppId(input.appId ?? input.agentId),
    articleRefs: input.articleRefs ?? [],
    maxHistoryMessages: normalizeHistoryDepth(input.maxHistoryMessages),
    messages: [],
  };
  writeConversation(root, conversation);
  return conversation;
}

export function getConversation(root: string, id: string): Conversation | null {
  const metadata = readConversationIndex(root).find((item) => item.id === id);
  if (metadata) {
    const conversation = readConversationFromMetadata(root, metadata);
    if (conversation && !fs.existsSync(conversationMessagesPath(root, id))) {
      writeConversation(root, conversation);
    }
    return conversation;
  }
  const legacy = readLegacyConversation(root, id);
  if (legacy) {
    writeConversation(root, legacy);
  }
  return legacy;
}

export function updateConversation(root: string, id: string, input: UpdateConversationInput): Conversation | null {
  const conversation = getConversation(root, id);
  if (!conversation) {
    return null;
  }

  if (typeof input.title === "string" && input.title.trim()) {
    conversation.title = input.title.trim();
  }
  if (typeof input.webSearchEnabled === "boolean") {
    conversation.webSearchEnabled = input.webSearchEnabled;
    if (!input.searchScope && !input.webSearchEnabled) {
      conversation.searchScope = "local";
    }
  }
  if (typeof input.searchScope === "string") {
    conversation.searchScope = normalizeSearchScope(input.searchScope, conversation.webSearchEnabled);
  }
  if (input.appId !== undefined || input.agentId !== undefined) {
    conversation.appId = normalizeAppId(input.appId ?? input.agentId);
  }
  if (Array.isArray(input.articleRefs)) {
    conversation.articleRefs = input.articleRefs;
  }
  if (typeof input.maxHistoryMessages === "number") {
    conversation.maxHistoryMessages = normalizeHistoryDepth(input.maxHistoryMessages);
  }
  conversation.updatedAt = new Date().toISOString();
  writeConversation(root, conversation);
  return conversation;
}

export function deleteConversation(root: string, id: string): boolean {
  const conversations = readConversationIndex(root);
  const nextConversations = conversations.filter((item) => item.id !== id);
  const hadIndexedConversation = nextConversations.length !== conversations.length;
  const messageFilePath = conversationMessagesPath(root, id);
  const legacyFilePath = legacyConversationPath(root, id);
  if (!hadIndexedConversation && !fs.existsSync(messageFilePath) && !fs.existsSync(legacyFilePath)) {
    return false;
  }
  writeConversationIndex(root, nextConversations);
  fs.rmSync(messageFilePath, { force: true });
  fs.rmSync(legacyFilePath, { force: true });
  return true;
}

export function addConversationMessage(root: string, id: string, input: AddMessageInput): Conversation | null {
  const conversation = getConversation(root, id);
  if (!conversation) {
    return null;
  }

  conversation.messages.push({
    id: crypto.randomUUID(),
    role: input.role,
    content: input.content,
    createdAt: new Date().toISOString(),
    articleRefs: input.articleRefs ?? [],
    references: normalizeReferences(input.references),
  });
  conversation.messages = conversation.messages.slice(-MAX_STORED_MESSAGES);
  if (input.articleRefs?.length) {
    conversation.articleRefs = input.articleRefs;
  }
  maybeRenameFromFirstUserMessage(conversation, input);
  conversation.updatedAt = new Date().toISOString();
  writeConversation(root, conversation);
  return conversation;
}

export function removeLastAssistantUserPair(root: string, id: string): RegenerateConversationTurn | null {
  const conversation = getConversation(root, id);
  if (!conversation) {
    return null;
  }
  const turn = findLastAssistantUserPair(conversation.messages);
  if (!turn) {
    return null;
  }
  conversation.messages.splice(turn.userIndex, turn.assistantIndex - turn.userIndex + 1);
  conversation.updatedAt = new Date().toISOString();
  writeConversation(root, conversation);
  return {
    conversation,
    content: turn.user.content,
    articleRefs: turn.user.articleRefs ?? [],
  };
}

function ensureChatHistoryDir(root: string): string {
  const dir = path.join(root, CHAT_HISTORY_DIR);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function ensureChatMessagesDir(root: string): string {
  const dir = path.join(ensureChatHistoryDir(root), CHAT_MESSAGES_DIR);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function conversationIndexPath(root: string): string {
  return path.join(ensureChatHistoryDir(root), CONVERSATION_INDEX_FILE);
}

function conversationMessagesPath(root: string, id: string): string {
  return path.join(ensureChatMessagesDir(root), `${id}.json`);
}

function legacyConversationPath(root: string, id: string): string {
  return path.join(root, LEGACY_CHAT_DIR, `${id}.json`);
}

function writeConversation(root: string, conversation: Conversation): void {
  writeConversationMetadata(root, conversation);
  fs.writeFileSync(
    conversationMessagesPath(root, conversation.id),
    JSON.stringify(conversation.messages.slice(-MAX_STORED_MESSAGES), null, 2),
  );
}

function writeConversationMetadata(root: string, conversation: Conversation): void {
  const next = upsertConversationMetadata(readConversationIndex(root), conversation);
  writeConversationIndex(root, next);
}

function readConversationIndex(root: string): Conversation[] {
  const indexPath = conversationIndexPath(root);
  if (fs.existsSync(indexPath)) {
    return normalizeConversations(JSON.parse(fs.readFileSync(indexPath, "utf8")));
  }
  return readLegacyConversationIndex(root);
}

function writeConversationIndex(root: string, conversations: Conversation[]): void {
  const metadata = conversations.map(stripConversationMessages);
  fs.writeFileSync(conversationIndexPath(root), JSON.stringify(metadata, null, 2));
}

function readConversationFromMetadata(root: string, metadata: Conversation): Conversation | null {
  const messages = fs.existsSync(conversationMessagesPath(root, metadata.id))
    ? readConversationMessages(root, metadata.id)
    : metadata.messages;
  return {
    ...metadata,
    messages,
  };
}

function readConversationMessages(root: string, id: string): ChatMessage[] {
  const filePath = conversationMessagesPath(root, id);
  if (!fs.existsSync(filePath)) {
    return [];
  }
  return normalizeMessages(JSON.parse(fs.readFileSync(filePath, "utf8"))).slice(-MAX_STORED_MESSAGES);
}

function readConversationFile(filePath: string): Conversation | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as Partial<Conversation>;
  return {
    id: String(parsed.id ?? ""),
    title: readConversationTitle(parsed.title),
    createdAt: readConversationTimestamp(parsed.createdAt),
    updatedAt: readConversationTimestamp(parsed.updatedAt),
    webSearchEnabled: parsed.webSearchEnabled === true,
    searchScope: normalizeSearchScope(parsed.searchScope, parsed.webSearchEnabled === true),
    appId: normalizeAppId(parsed.appId ?? parsed.agentId),
    articleRefs: normalizeStringArray(parsed.articleRefs),
    maxHistoryMessages: normalizeHistoryDepth(parsed.maxHistoryMessages),
    messages: normalizeMessages(parsed.messages),
  };
}

function readLegacyConversation(root: string, id: string): Conversation | null {
  return readConversationFile(legacyConversationPath(root, id));
}

function readLegacyConversationIndex(root: string): Conversation[] {
  const legacyDir = path.join(root, LEGACY_CHAT_DIR);
  if (!fs.existsSync(legacyDir)) {
    return readLegacyFlatChatHistory(root);
  }
  return fs.readdirSync(legacyDir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => readConversationFile(path.join(legacyDir, name)))
    .filter((conversation): conversation is Conversation => conversation !== null);
}

function readLegacyFlatChatHistory(root: string): Conversation[] {
  const filePath = path.join(root, CHAT_HISTORY_DIR, "chat-history.json");
  if (!fs.existsSync(filePath)) {
    return [];
  }
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (isPersistedChatData(parsed)) {
    return normalizePersistedChatData(parsed);
  }
  const messages = normalizeLegacyMessages(parsed);
  const now = new Date().toISOString();
  return [{
    id: "default",
    title: "Previous Conversations",
    createdAt: messages[0]?.createdAt ?? now,
    updatedAt: messages.at(-1)?.createdAt ?? now,
    webSearchEnabled: false,
    searchScope: "local",
    appId: null,
    articleRefs: [],
    maxHistoryMessages: DEFAULT_HISTORY_MESSAGES,
    messages,
  }];
}

function isPersistedChatData(value: unknown): value is { conversations: unknown[]; messages: unknown[] } {
  return Boolean(value && typeof value === "object"
    && Array.isArray((value as { conversations?: unknown }).conversations)
    && Array.isArray((value as { messages?: unknown }).messages));
}

function normalizePersistedChatData(value: { conversations: unknown[]; messages: unknown[] }): Conversation[] {
  const messages = normalizeLegacyMessages(value.messages);
  return value.conversations
    .map((item) => normalizeLegacyConversation(item, messages))
    .filter((conversation): conversation is Conversation => conversation !== null);
}

function normalizeLegacyConversation(value: unknown, messages: ChatMessage[]): Conversation | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Partial<Conversation> & { createdAt?: string | number; updatedAt?: string | number };
  const id = readTrimmedString(record.id);
  if (!id) {
    return null;
  }
  return {
    id,
    title: readConversationTitle(record.title),
    createdAt: readLegacyTimestamp(record.createdAt),
    updatedAt: readLegacyTimestamp(record.updatedAt),
    webSearchEnabled: false,
    searchScope: "local",
    appId: null,
    articleRefs: [],
    maxHistoryMessages: DEFAULT_HISTORY_MESSAGES,
    messages: messages.filter((message) => (message as ChatMessage & { conversationId?: string }).conversationId === id),
  };
}

function stripConversationMessages(conversation: Conversation): Conversation {
  return {
    ...conversation,
    messages: [],
  };
}

function upsertConversationMetadata(conversations: Conversation[], conversation: Conversation): Conversation[] {
  const metadata = stripConversationMessages(conversation);
  const exists = conversations.some((item) => item.id === conversation.id);
  if (!exists) {
    return [metadata, ...conversations];
  }
  return conversations.map((item) => item.id === conversation.id ? metadata : item);
}

function normalizeConversations(value: unknown): Conversation[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map(normalizeConversationMetadata)
    .filter((conversation): conversation is Conversation => conversation !== null);
}

function normalizeConversationMetadata(value: unknown): Conversation | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  return readConversationFileRecord(value as Partial<Conversation>);
}

function readConversationFileRecord(parsed: Partial<Conversation>): Conversation | null {
  const id = readTrimmedString(parsed.id);
  if (!id) {
    return null;
  }
  return {
    id,
    title: readConversationTitle(parsed.title),
    createdAt: readConversationTimestamp(parsed.createdAt),
    updatedAt: readConversationTimestamp(parsed.updatedAt),
    webSearchEnabled: parsed.webSearchEnabled === true,
    searchScope: normalizeSearchScope(parsed.searchScope, parsed.webSearchEnabled === true),
    appId: normalizeAppId(parsed.appId ?? parsed.agentId),
    articleRefs: normalizeStringArray(parsed.articleRefs),
    maxHistoryMessages: normalizeHistoryDepth(parsed.maxHistoryMessages),
    messages: normalizeMessages(parsed.messages),
  };
}

function normalizeAppId(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeSearchScope(
  value: Conversation["searchScope"] | undefined,
  webSearchEnabled: boolean | undefined,
): Conversation["searchScope"] {
  if (value === "web" || value === "all") {
    return value;
  }
  if (value === "local") {
    return "local";
  }
  return webSearchEnabled ? "web" : "local";
}

function readConversationTitle(value: unknown): string {
  return typeof value === "string" && value.trim() ? value : "\u65b0\u5bf9\u8bdd";
}

function readConversationTimestamp(value: unknown): string {
  return typeof value === "string" ? value : new Date().toISOString();
}

function readLegacyTimestamp(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }
  return readConversationTimestamp(value);
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

function normalizeMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map(normalizeMessage)
    .filter((message): message is ChatMessage => message !== null);
}

function normalizeLegacyMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map(normalizeLegacyMessage)
    .filter((message): message is ChatMessage => message !== null);
}

function normalizeMessage(value: unknown): ChatMessage | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Partial<ChatMessage>;
  if (record.role !== "user" && record.role !== "assistant" && record.role !== "system") {
    return null;
  }
  return {
    id: typeof record.id === "string" ? record.id : crypto.randomUUID(),
    role: record.role,
    content: typeof record.content === "string" ? record.content : "",
    createdAt: readConversationTimestamp(record.createdAt),
    articleRefs: normalizeStringArray(record.articleRefs),
    references: normalizeReferences(record.references),
  };
}

function normalizeLegacyMessage(value: unknown): (ChatMessage & { conversationId?: string }) | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Partial<ChatMessage> & {
    timestamp?: string | number;
    conversationId?: string;
  };
  const message = normalizeMessage({
    ...record,
    createdAt: record.createdAt ?? readLegacyTimestamp(record.timestamp),
  });
  if (!message) {
    return null;
  }
  return {
    ...message,
    conversationId: readOptionalTrimmedString(record.conversationId),
  };
}

function normalizeReferences(value: unknown): ChatMessageReference[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map(normalizeReference)
    .filter((reference): reference is ChatMessageReference => reference !== null);
}

function normalizeReference(value: unknown): ChatMessageReference | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Partial<ChatMessageReference>;
  const title = readTrimmedString(record.title);
  const pathValue = readOptionalTrimmedString(record.path);
  const urlValue = readOptionalTrimmedString(record.url);
  if (!isValidReferenceIdentity(title, pathValue, urlValue)) {
    return null;
  }
  const normalized: ChatMessageReference = {
    index: normalizeReferenceIndex(record.index),
    kind: record.kind === "web" ? "web" : "wiki",
    title,
    excerpt: readTrimmedString(record.excerpt),
  };
  if (pathValue) normalized.path = pathValue;
  if (urlValue) normalized.url = urlValue;
  const images = normalizeReferenceImages(record.images);
  if (images.length > 0) normalized.images = images;
  return normalized;
}

function normalizeReferenceImages(value: unknown): ChatMessageReferenceImage[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Partial<ChatMessageReferenceImage>;
    const url = readOptionalTrimmedString(record.url);
    if (!url) return [];
    return [{
      alt: readTrimmedString(record.alt),
      url,
    }];
  });
}

function readTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readOptionalTrimmedString(value: unknown): string | undefined {
  const trimmed = readTrimmedString(value);
  return trimmed || undefined;
}

function isValidReferenceIdentity(title: string, pathValue: string | undefined, urlValue: string | undefined): boolean {
  return Boolean(title && (pathValue || urlValue));
}

function normalizeReferenceIndex(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : 0;
}

function normalizeHistoryDepth(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_HISTORY_MESSAGES;
  }
  return Math.max(1, Math.min(100, Math.trunc(value)));
}

function maybeRenameFromFirstUserMessage(conversation: Conversation, input: AddMessageInput): void {
  if (input.role !== "user" || conversation.title !== NEW_CONVERSATION_TITLE) {
    return;
  }
  const userMessages = conversation.messages.filter((message) => message.role === "user");
  if (userMessages.length === 1) {
    conversation.title = input.content.slice(0, 50);
  }
}

function findLastAssistantUserPair(messages: ChatMessage[]): {
  assistantIndex: number;
  userIndex: number;
  user: ChatMessage;
} | null {
  const assistantIndex = findLastMessageIndex(messages, "assistant");
  if (assistantIndex < 0) {
    return null;
  }
  const userIndex = findPreviousMessageIndex(messages, assistantIndex, "user");
  const user = messages[userIndex];
  return userIndex >= 0 && user ? { assistantIndex, userIndex, user } : null;
}

function findLastMessageIndex(messages: ChatMessage[], role: ChatMessage["role"]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === role) {
      return index;
    }
  }
  return -1;
}

function findPreviousMessageIndex(messages: ChatMessage[], before: number, role: ChatMessage["role"]): number {
  for (let index = before - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === role) {
      return index;
    }
  }
  return -1;
}
