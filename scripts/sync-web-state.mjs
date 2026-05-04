#!/usr/bin/env node
/**
 * Sync desktop web state with the hosted `/api/sync-state` endpoint.
 *
 * This wrapper coordinates local file reads, remote fetch/post calls, and
 * persistence while delegating record normalization to the core helper module.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  mergeByUpdatedAt,
  normalizeArray,
  normalizeComment,
  normalizeConversation,
} from "./sync-web-state-core.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const chatDir = path.join(projectRoot, ".chat");
const commentsFile = path.join(projectRoot, ".comments", "wiki-comments.json");
const remoteBase = normalizeBaseUrl(process.env.LLM_WIKI_WEB_URL || "https://llm-wiki.cn");

const localConversations = readLocalConversations();
const localComments = readJsonArray(commentsFile).map(normalizeComment).filter(Boolean);
const remoteState = await fetchJson(`${remoteBase}/api/sync-state`);

const conversations = mergeByUpdatedAt(
  localConversations,
  Array.isArray(remoteState.conversations) ? remoteState.conversations.map(normalizeConversation).filter(Boolean) : []
);
const comments = mergeByUpdatedAt(
  localComments,
  Array.isArray(remoteState.comments) ? remoteState.comments.map(normalizeComment).filter(Boolean) : []
);

await postJson(`${remoteBase}/api/sync-state`, { conversations, comments });
writeLocalConversations(conversations);
writeJsonArray(commentsFile, comments);

console.log(`Synced ${conversations.length} conversations and ${comments.length} comments with ${remoteBase}`);

// fallow-ignore-next-line complexity
function readLocalConversations() {
  if (!fs.existsSync(chatDir)) return [];
  return fs
    .readdirSync(chatDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => readJson(path.join(chatDir, entry.name)))
    .map(normalizeConversation)
    .filter(Boolean);
}

// fallow-ignore-next-line complexity
function writeLocalConversations(conversations) {
  fs.mkdirSync(chatDir, { recursive: true });
  for (const conversation of conversations) {
    const fileName = `${safeFileName(conversation.id)}.json`;
    fs.writeFileSync(path.join(chatDir, fileName), `${JSON.stringify(conversation, null, 2)}\n`, "utf8");
  }
}

// fallow-ignore-next-line complexity
async function fetchJson(url) {
  const response = await fetch(url);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.success) {
    throw new Error(payload.error || `Sync fetch failed: ${response.status}`);
  }
  return payload.data || {};
}

// fallow-ignore-next-line complexity
async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.success) {
    throw new Error(payload.error || `Sync post failed: ${response.status}`);
  }
  return payload.data;
}

// fallow-ignore-next-line complexity
function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

// fallow-ignore-next-line complexity
function readJsonArray(file) {
  const data = readJson(file);
  return Array.isArray(data) ? data : [];
}

// fallow-ignore-next-line complexity
function writeJsonArray(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

// fallow-ignore-next-line complexity
function normalizeBaseUrl(value) {
  return String(value || "").replace(/\/+$/, "");
}

// fallow-ignore-next-line complexity
function safeFileName(value) {
  return String(value).replace(/[<>:"/\\|?*\x00-\x1F]/g, "_");
}
