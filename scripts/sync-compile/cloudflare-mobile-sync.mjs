/**
 * Cloudflare-backed mobile sync orchestration.
 *
 * This module keeps the public sync/publish entry points stable while delegating
 * record building and media persistence details to a smaller core helper.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { ProxyAgent, fetch as undiciFetch } from "undici";
import { listMarkdownFilesRecursive } from "./file-listing.mjs";
import {
  prepareEntryMedia,
  sanitizeFileName,
  toSlash,
} from "./cloudflare-mobile-sync-core.mjs";

export { buildWikiPageRecords } from "./cloudflare-mobile-sync-core.mjs";

const DEFAULT_CLOUDFLARE_TIMEOUT_MS = 60000;
const CLOUDFLARE_PUBLISH_BATCH_SIZE = 20;
const CLOUDFLARE_PUBLISH_STATE_FILE = path.join(".llmwiki", "cloudflare-publish-state.json");

const RAW_DIR_NAME = "raw";
const FLASH_DIR_NAME = "\u95ea\u5ff5\u65e5\u8bb0";
const CLIPPING_DIR_NAME = "\u526a\u85cf";
const INBOX_DIR_NAME = "inbox";
const CHINA_TIME_ZONE = "Asia/Shanghai";
const CHINA_DATE_TIME_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: CHINA_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
  hourCycle: "h23",
});

export async function syncMobileEntriesFromCloudflare({ projectRoot, vaultRoot, now = new Date().toISOString() }) {
  try {
    const client = getConfiguredCloudflare(projectRoot);
    if (!client) return { pulledCount: 0, failedCount: 0, skipped: true };
    return await withCloudflareTimeout(syncMobileEntriesToRawFromCloudflare({ vaultRoot, client, now }));
  } catch (error) {
    return {
      pulledCount: 0,
      failedCount: 1,
      skipped: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function publishWikiToCloudflare({ projectRoot, vaultRoot, mobileDiaryRoot = vaultRoot, version = new Date().toISOString() }) {
  try {
    const client = getConfiguredCloudflare(projectRoot);
    if (!client) return { publishedCount: 0, skipped: true };
    const files = await buildCloudflareWikiFiles(vaultRoot);
    const publishVersion = buildCloudflarePublishVersion(files);
    const lastPublishState = await readCloudflarePublishState(vaultRoot);
    if (lastPublishState?.publishVersion === publishVersion) {
      const mobileDiary = await withCloudflareTimeout(syncDesktopFlashDiariesToCloudflare({ vaultRoot: mobileDiaryRoot, client, now: version }));
      return {
        publishedCount: 0,
        vectorUpserted: 0,
        vectorErrors: 0,
        skipped: true,
        publishVersion,
        mobileDiaryPushed: mobileDiary.pushedCount,
        mobileDiaryFailed: mobileDiary.failedCount,
      };
    }
    let publishedCount = 0;
    let vectorUpserted = 0;
    let vectorErrors = 0;
    for (const batch of chunkArray(files, CLOUDFLARE_PUBLISH_BATCH_SIZE)) {
      const response = await withCloudflareTimeout(postCloudflareWorker(client, "/publish", {
        action: "publish",
        wikiRoot: path.basename(vaultRoot),
        publishVersion,
        publishedAt: version,
        files: batch,
        indexFiles: [],
      }));
      publishedCount += Number(response.pageCount ?? batch.length);
      vectorUpserted += Number(response.vectorUpserted ?? 0);
      vectorErrors += Number(response.vectorErrors ?? 0);
    }
    await writeCloudflarePublishState(vaultRoot, {
      publishVersion,
      publishedAt: version,
    });
    const mobileDiary = await withCloudflareTimeout(syncDesktopFlashDiariesToCloudflare({ vaultRoot: mobileDiaryRoot, client, now: version }));
    return {
      publishedCount,
      vectorUpserted,
      vectorErrors,
      skipped: false,
      publishVersion,
      mobileDiaryPushed: mobileDiary.pushedCount,
      mobileDiaryFailed: mobileDiary.failedCount,
    };
  } catch (error) {
    return {
      publishedCount: 0,
      skipped: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function syncDesktopFlashDiariesToCloudflare({ vaultRoot, client, now = new Date().toISOString() }) {
  const diaryDir = path.join(vaultRoot, RAW_DIR_NAME, FLASH_DIR_NAME);
  if (!existsSync(diaryDir)) return { pushedCount: 0, failedCount: 0 };

  const fileNames = (await readdir(diaryDir, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && /^\d{4}-\d{2}-\d{2}\.md$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  let pushedCount = 0;
  let failedCount = 0;

  for (const fileName of fileNames) {
    const targetDate = fileName.replace(/\.md$/i, "");
    const filePath = path.join(diaryDir, fileName);
    const raw = await readFile(filePath, "utf8");
    const entries = parseDesktopFlashDiaryEntries(raw, {
      targetDate,
      desktopPath: toSlash(path.join(RAW_DIR_NAME, FLASH_DIR_NAME, fileName)),
      now,
    });

    for (const entry of entries) {
      try {
        await postCloudflareWorker(client, "/mobile/entries", entry);
        pushedCount += 1;
      } catch {
        failedCount += 1;
      }
    }
  }

  return { pushedCount, failedCount };
}

export async function syncMobileEntriesToRaw({ vaultRoot, db, now = new Date().toISOString() }) {
  const snapshot = await db.collection("mobile_entries").where("status", "==", "new").get();
  let pulledCount = 0;
  let failedCount = 0;

  for (const doc of snapshot.docs ?? []) {
    const entry = { id: doc.id, ...doc.data() };
    try {
      await writeMobileEntry(vaultRoot, entry, now);
      await doc.ref.update({
        status: "synced",
        syncedAt: now,
        desktopPath: getEntryDesktopPath(vaultRoot, entry, now),
      });
      pulledCount += 1;
    } catch (error) {
      failedCount += 1;
      await doc.ref.update({
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
        failedAt: now,
      }).catch(() => {});
    }
  }

  return { pulledCount, failedCount };
}

export async function syncMobileEntriesToRawFromCloudflare({ vaultRoot, client, now = new Date().toISOString() }) {
  const response = await postCloudflareWorker(client, "/mobile/entries/pending", {});
  const entries = Array.isArray(response.entries) ? response.entries : [];
  let pulledCount = 0;
  let failedCount = 0;

  for (const entry of entries) {
    try {
      await writeMobileEntry(vaultRoot, entry, now);
      await postCloudflareWorker(client, "/mobile/entries/status", {
        id: entry.id,
        status: "synced",
        syncedAt: now,
        desktopPath: getEntryDesktopPath(vaultRoot, entry, now),
      });
      pulledCount += 1;
    } catch (error) {
      failedCount += 1;
      await postCloudflareWorker(client, "/mobile/entries/status", {
        id: entry.id,
        status: "failed",
        failedAt: now,
        error: error instanceof Error ? error.message : String(error),
      }).catch(() => {});
    }
  }

  return { pulledCount, failedCount };
}

function withCloudflareTimeout(promise) {
  const timeoutMs = Number(process.env.LLM_WIKI_CLOUDFLARE_TIMEOUT_MS ?? DEFAULT_CLOUDFLARE_TIMEOUT_MS);
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`Cloudflare operation timed out after ${timeoutMs}ms.`)), timeoutMs);
    }),
  ]);
}

function chunkArray(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

// fallow-ignore-next-line complexity
function getConfiguredCloudflare(projectRoot) {
  const envFile = readDotEnvFile(path.join(projectRoot, ".env"));
  const syncConfig = readSyncCompileConfig(projectRoot);
  const workerUrl = normalizeEnvValue(process.env.CLOUDFLARE_WORKER_URL ?? envFile.CLOUDFLARE_WORKER_URL ?? syncConfig.cloudflare_worker_url);
  const accountSessionToken = normalizeEnvValue(process.env.CLOUDFLARE_ACCOUNT_SESSION_TOKEN);
  const workspaceId = normalizeEnvValue(process.env.CLOUDFLARE_WORKSPACE_ID ?? syncConfig.cloudflare_workspace_id);
  const remoteToken = normalizeEnvValue(process.env.CLOUDFLARE_REMOTE_TOKEN ?? envFile.CLOUDFLARE_REMOTE_TOKEN);
  const proxyUrl = readConfiguredProxyUrl(envFile);
  if (workerUrl && accountSessionToken && workspaceId) {
    return {
      workerUrl: workerUrl.replace(/\/+$/, ""),
      accountSessionToken,
      workspaceId,
      proxyUrl,
    };
  }
  if (!workerUrl || !remoteToken) return null;
  return {
    workerUrl: workerUrl.replace(/\/+$/, ""),
    remoteToken,
    proxyUrl,
  };
}

function readSyncCompileConfig(projectRoot) {
  const configPath = path.join(projectRoot, "sync-compile-config.json");
  if (!existsSync(configPath)) return {};
  try {
    return JSON.parse(readFileSync(configPath, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return {};
  }
}

function readDotEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  const out = {};
  const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^\s*([^#][^=]+?)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    out[match[1].trim()] = normalizeEnvValue(match[2]);
  }
  return out;
}

function normalizeEnvValue(value) {
  return String(value ?? "").trim().replace(/^["']|["']$/g, "");
}

async function postCloudflareWorker(client, endpointPath, payload) {
  const resolvedPath = resolveCloudflareEndpointPath(client, endpointPath);
  const resolvedPayload = client.accountSessionToken && client.workspaceId
    ? { workspaceId: client.workspaceId, ...payload }
    : payload;
  const response = await fetchWithOptionalProxy(`${client.workerUrl}/${resolvedPath.replace(/^\/+/, "")}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${client.accountSessionToken ?? client.remoteToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(resolvedPayload),
  }, client.proxyUrl);
  const text = await response.text();
  const parsed = text ? JSON.parse(text) : {};
  if (!response.ok || parsed.ok === false) {
    throw new Error(parsed.error || `Cloudflare Worker returned ${response.status}`);
  }
  return parsed;
}

function resolveCloudflareEndpointPath(client, endpointPath) {
  if (!client.accountSessionToken) return endpointPath;
  if (endpointPath === "/publish") return "/user/publish";
  if (endpointPath.startsWith("/mobile/")) return `/user${endpointPath}`;
  return endpointPath;
}

async function fetchWithOptionalProxy(endpoint, options, configuredProxyUrl = "") {
  const proxyUrl = normalizeEnvValue(configuredProxyUrl) || readProcessProxyUrl();
  if (!proxyUrl) {
    return fetch(endpoint, options);
  }
  return undiciFetch(endpoint, {
    ...options,
    dispatcher: new ProxyAgent(proxyUrl),
  });
}

function readConfiguredProxyUrl(envFile) {
  return firstConfiguredEnvValue(
    process.env.GLOBAL_AGENT_HTTPS_PROXY,
    process.env.GLOBAL_AGENT_HTTP_PROXY,
    process.env.HTTPS_PROXY,
    process.env.HTTP_PROXY,
    process.env.https_proxy,
    process.env.http_proxy,
    envFile.GLOBAL_AGENT_HTTPS_PROXY,
    envFile.GLOBAL_AGENT_HTTP_PROXY,
    envFile.HTTPS_PROXY,
    envFile.HTTP_PROXY,
    envFile.https_proxy,
    envFile.http_proxy,
  );
}

function readProcessProxyUrl() {
  return firstConfiguredEnvValue(
    process.env.GLOBAL_AGENT_HTTPS_PROXY,
    process.env.GLOBAL_AGENT_HTTP_PROXY,
    process.env.HTTPS_PROXY,
    process.env.HTTP_PROXY,
    process.env.https_proxy,
    process.env.http_proxy,
  );
}

function firstConfiguredEnvValue(...values) {
  for (const value of values) {
    const text = normalizeEnvValue(value);
    if (text) return text;
  }
  return "";
}

async function buildCloudflareWikiFiles(vaultRoot) {
  const wikiRoot = path.join(vaultRoot, "wiki");
  const files = await listMarkdownFilesRecursive(wikiRoot, {
    ignoreMissing: true,
    normalizeSlashes: true,
  });
  const out = [];
  for (const relativePath of files) {
    const fullPath = path.join(wikiRoot, relativePath);
    const content = await readFile(fullPath, "utf8");
    const fileStat = await stat(fullPath);
    out.push({
      path: toSlash(path.join("wiki", relativePath)),
      content,
      hash: createHash("sha256").update(content).digest("hex"),
      modifiedAt: fileStat.mtime.toISOString(),
    });
  }
  return out;
}

export function buildCloudflarePublishVersion(files) {
  const manifest = files
    .map((file) => `${file.path}\n${file.hash}`)
    .sort()
    .join("\n");
  return createHash("sha256").update(manifest).digest("hex");
}

export function createCloudflareWikiPublishScheduler({
  publishWiki,
  debounceMs = 800,
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout,
  onError = defaultCloudflarePublishErrorHandler,
}) {
  let debounceTimer = null;
  let isRunning = false;
  let hasPendingRun = false;

  async function runPublish() {
    if (isRunning) {
      hasPendingRun = true;
      return;
    }

    isRunning = true;
    try {
      await publishWiki();
    } catch (error) {
      onError(error);
    } finally {
      isRunning = false;
      if (hasPendingRun) {
        hasPendingRun = false;
        await runPublish();
      }
    }
  }

  function scheduleChange(_eventPath) {
    if (debounceTimer) {
      clearTimeoutImpl(debounceTimer);
    }
    debounceTimer = setTimeoutImpl(() => {
      debounceTimer = null;
      void runPublish();
    }, debounceMs);
  }

  return {
    scheduleChange,
    async reconcileNow() {
      await runPublish();
    },
  };
}

async function readCloudflarePublishState(vaultRoot) {
  const filePath = path.join(vaultRoot, CLOUDFLARE_PUBLISH_STATE_FILE);
  if (!existsSync(filePath)) {
    return null;
  }
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    const publishVersion = String(parsed?.publishVersion ?? "").trim();
    const publishedAt = String(parsed?.publishedAt ?? "").trim();
    if (!publishVersion) {
      return null;
    }
    return { publishVersion, publishedAt };
  } catch {
    return null;
  }
}

async function writeCloudflarePublishState(vaultRoot, state) {
  const filePath = path.join(vaultRoot, CLOUDFLARE_PUBLISH_STATE_FILE);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(state, null, 2), "utf8");
}

function defaultCloudflarePublishErrorHandler(error) {
  console.error(error instanceof Error ? error.message : String(error));
}

function parseDesktopFlashDiaryEntries(raw, { targetDate, desktopPath, now }) {
  const headingRegex = /^##\s+(\d{2}:\d{2}(?::\d{2})?)\s*$/gm;
  const headings = [...raw.matchAll(headingRegex)];
  const entries = [];

  for (let index = 0; index < headings.length; index += 1) {
    const heading = headings[index];
    const nextHeading = headings[index + 1];
    const time = normalizeDiaryTime(heading[1]);
    const bodyStart = Number(heading.index ?? 0) + heading[0].length;
    const bodyEnd = Number(nextHeading?.index ?? raw.length);
    const text = normalizeDesktopDiaryText(raw.slice(bodyStart, bodyEnd));
    if (!text) continue;
    entries.push({
      id: buildDesktopFlashDiaryEntryId(targetDate, time, text),
      ownerUid: "",
      type: "flash_diary",
      title: buildDesktopFlashDiaryTitle(text, targetDate),
      text,
      mediaFiles: extractDesktopDiaryMedia(text),
      createdAt: `${targetDate}T${time}+08:00`,
      targetDate,
      status: "synced",
      channel: "desktop-flash-diary",
      sourceName: "电脑端日记",
      desktopPath,
      syncedAt: now,
    });
  }

  return entries;
}

function normalizeDiaryTime(time) {
  return /^\d{2}:\d{2}$/.test(time) ? `${time}:00` : time;
}

function normalizeDesktopDiaryText(value) {
  return String(value)
    .replace(/(?:^|\r?\n)---\s*$/g, "")
    .trim();
}

function buildDesktopFlashDiaryTitle(text, targetDate) {
  const line = text
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find((item) => item && !item.startsWith("!["));
  return (line || `${targetDate} 闪念日记`).replace(/\s+/g, " ").slice(0, 48);
}

function buildDesktopFlashDiaryEntryId(targetDate, time, text) {
  const digest = createHash("sha1").update(`${targetDate}\n${time}\n${text}`).digest("hex").slice(0, 12);
  return `desktop-flash-${targetDate}-${time.replace(/:/g, "")}-${digest}`;
}

function extractDesktopDiaryMedia(text) {
  const urls = [];
  for (const match of String(text).matchAll(/!\[[^\]]*]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g)) {
    const url = match[1];
    if (/^https?:\/\//i.test(url) && !urls.includes(url)) urls.push(url);
  }
  return urls;
}

async function writeMobileEntry(vaultRoot, entry, now) {
  switch (entry.type) {
    case "flash_diary":
      await writeFlashDiaryEntry(vaultRoot, entry, now);
      return;
    case "clipping":
      await writeMarkdownFile(path.join(vaultRoot, RAW_DIR_NAME, CLIPPING_DIR_NAME), entry, now);
      return;
    case "inbox":
      await writeMarkdownFile(path.join(vaultRoot, INBOX_DIR_NAME), entry, now);
      return;
    default:
      throw new Error(`Unsupported mobile entry type: ${entry.type ?? "unknown"}`);
  }
}

function getEntryDesktopPath(vaultRoot, entry, now) {
  if (entry.type === "flash_diary") {
    return toSlash(path.join(vaultRoot, RAW_DIR_NAME, FLASH_DIR_NAME, `${getEntryDate(entry, now)}.md`));
  }
  if (entry.type === "clipping") {
    return toSlash(path.join(vaultRoot, RAW_DIR_NAME, CLIPPING_DIR_NAME, `${sanitizeFileName(entry.title ?? entry.id)}.md`));
  }
  return toSlash(path.join(vaultRoot, INBOX_DIR_NAME, `${sanitizeFileName(entry.title ?? entry.id)}.md`));
}

async function writeFlashDiaryEntry(vaultRoot, entry, now) {
  const date = getEntryDate(entry, now);
  const dir = path.join(vaultRoot, RAW_DIR_NAME, FLASH_DIR_NAME);
  const filePath = path.join(dir, `${date}.md`);
  await mkdir(dir, { recursive: true });
  const mediaFiles = await prepareEntryMedia(entry, dir, date);
  const block = formatDiaryBlocks(entry, now, mediaFiles);
  const existing = existsSync(filePath) ? await readFile(filePath, "utf8") : "";
  await writeFile(filePath, insertDiaryBlock(existing, date, block), "utf8");
}

async function writeMarkdownFile(dir, entry, now) {
  await mkdir(dir, { recursive: true });
  const fileName = `${sanitizeFileName(entry.title ?? entry.id ?? "mobile-entry")}.md`;
  const filePath = path.join(dir, fileName);
  const mediaFiles = await prepareEntryMedia(entry, dir, sanitizeFileName(entry.id ?? entry.title ?? "mobile-entry"));
  await writeFile(filePath, formatMobileEntryMarkdown(entry, now, mediaFiles), "utf8");
}

function insertDiaryBlock(existing, date, block) {
  const newBlocks = splitDiaryBlocks(block).blocks.map((item) => item.markdown);
  const sortedNewBlocks = sortDiaryBlocksByTime(newBlocks);
  const normalizedExisting = normalizeDiaryHeadingBreaks(existing);
  if (!normalizedExisting.trim()) return `# ${date} \u95ea\u5ff5\u65e5\u8bb0\n\n${sortedNewBlocks.join("\n\n")}\n`;
  const heading = normalizedExisting.match(/^# .+?\r?\n/);
  if (!heading) return `# ${date} \u95ea\u5ff5\u65e5\u8bb0\n\n${sortedNewBlocks.join("\n\n")}\n${normalizedExisting.trimStart()}`;
  const body = normalizedExisting.slice(heading[0].length).replace(/^\r?\n/, "");
  const mergedBody = newBlocks.reduceRight((current, item) => mergeDiaryBlock(current, item), body);
  return `${heading[0]}\n${mergedBody.trimStart()}`;
}

function formatDiaryBlocks(entry, now, mediaFiles = []) {
  const segments = splitDiaryTextSegments(entry, now);
  return segments
    .map((segment, index) => formatDiaryBlock(segment.time, segment.text, index === 0 ? mediaFiles : []))
    .join("\n");
}

function formatDiaryBlock(time, text, mediaFiles = []) {
  const media = formatMedia(mediaFiles);
  return [
    `## ${time}`,
    "",
    text,
    media,
    "",
  ].filter((part) => part !== "").join("\n");
}

function mergeDiaryBlock(existingBody, newBlock) {
  const parsed = splitDiaryBlocks(existingBody);
  const newKey = diaryBlockDedupeKey(newBlock);
  let selectedBlock = newBlock.trim();
  const keptBlocks = [];

  for (const block of parsed.blocks) {
    if (newKey && diaryBlockDedupeKey(block.markdown) === newKey) {
      selectedBlock = preferRicherDiaryBlock(selectedBlock, block.markdown);
      continue;
    }
    keptBlocks.push(block.markdown);
  }

  return [...sortDiaryBlocksByTime([selectedBlock, ...keptBlocks]), parsed.intro]
    .map((item) => item.trim())
    .filter(Boolean)
    .join("\n\n")
    .concat("\n");
}

function sortDiaryBlocksByTime(blocks) {
  return blocks
    .map((markdown, index) => ({ markdown, index, seconds: diaryBlockTimeSeconds(markdown) }))
    .sort((left, right) => right.seconds - left.seconds || left.index - right.index)
    .map((item) => item.markdown);
}

function splitDiaryBlocks(markdown) {
  const normalized = normalizeDiaryHeadingBreaks(markdown).trim();
  const matches = [...normalized.matchAll(/^##\s+.*\d{2}:\d{2}(?::\d{2})?.*$/gm)];
  if (matches.length === 0) return { intro: normalized, blocks: [] };
  const intro = normalized.slice(0, Number(matches[0].index ?? 0)).trim();
  const blocks = matches.map((match, index) => {
    const start = Number(match.index ?? 0);
    const end = Number(matches[index + 1]?.index ?? normalized.length);
    return { markdown: normalized.slice(start, end).trim() };
  });
  return { intro, blocks };
}

function normalizeDiaryHeadingBreaks(markdown) {
  return String(markdown).replace(/([^\r\n])(?=##\s+(?:\[§][^\r\n]*\s+)?\d{2}:\d{2})/g, "$1\n\n");
}

function diaryBlockTimeSeconds(block) {
  const time = String(block).match(/^##\s+.*?(\d{2}:\d{2}(?::\d{2})?)/m)?.[1] ?? "00:00";
  const [hour = "0", minute = "0", second = "0"] = time.split(":");
  return Number(hour) * 3600 + Number(minute) * 60 + Number(second);
}

function diaryBlockDedupeKey(block) {
  const heading = String(block).match(/^##\s+(.+)$/m);
  const time = heading?.[1]?.match(/\d{2}:\d{2}(?::\d{2})?/)?.[0];
  if (!time || heading.index === undefined) return "";
  const body = String(block).slice(heading.index + heading[0].length);
  const text = body
    .replace(/(?:^|\r?\n)###\s*\u9644\u4ef6[\s\S]*$/m, "")
    .replace(/!\[[^\]]*]\([^)]+\)/g, "")
    .replace(/-\s+\[[^\]]*]\([^)]+\)/g, "")
    .replace(/^---$/gm, "")
    .replace(/\s+/g, " ")
    .trim();
  return text ? `${normalizeDiaryTime(time)}\u0001${text}` : "";
}

function preferRicherDiaryBlock(candidate, existing) {
  return diaryBlockMediaScore(existing) > diaryBlockMediaScore(candidate)
    ? existing.trim()
    : candidate.trim();
}

function diaryBlockMediaScore(block) {
  const mediaRefs = [...String(block).matchAll(/!\[[^\]]*]\(([^)]+)\)|-\s+\[[^\]]*]\(([^)]+)\)/g)]
    .map((match) => String(match[1] ?? match[2] ?? ""));
  const localRefs = mediaRefs.filter((item) => item && !/^https?:\/\//i.test(item)).length;
  return mediaRefs.length * 10 + localRefs;
}

function splitDiaryTextSegments(entry, now) {
  const text = String(entry.text ?? "").trim();
  if (!text) return [];
  const matches = [...text.matchAll(/##\s+(\d{2}:\d{2}(?::\d{2})?)(?=\s|$)/g)];
  if (matches.length === 0) {
    return [{ time: formatEntryChinaTime(entry.createdAt ?? now), text }];
  }
  return splitTextByDiaryHeadings(text, matches, entry, now);
}

// fallow-ignore-next-line complexity
function splitTextByDiaryHeadings(text, matches, entry, now) {
  const segments = [];
  const firstText = text.slice(0, Number(matches[0].index ?? 0)).trim();
  if (firstText) segments.push({ time: formatEntryChinaTime(entry.createdAt ?? now), text: firstText });
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const next = matches[index + 1];
    const start = Number(match.index ?? 0) + match[0].length;
    const end = Number(next?.index ?? text.length);
    const body = text.slice(start, end).trim();
    if (body) segments.push({ time: formatEmbeddedDiaryTime(entry, match[1], now), text: body });
  }
  return segments.length > 0 ? segments : [{ time: formatEntryChinaTime(entry.createdAt ?? now), text }];
}

function formatEntryChinaTime(value) {
  return formatChinaDateTime(value).time;
}

function formatEmbeddedDiaryTime(entry, time, now) {
  const normalized = normalizeDiaryTime(time);
  if (!isUtcLikeTimestamp(entry.createdAt)) return normalized;
  return formatChinaDateTime(`${getEntryDate(entry, now)}T${normalized}Z`).time;
}

// fallow-ignore-next-line complexity
function formatMobileEntryMarkdown(entry, now, mediaFiles = []) {
  const title = String(entry.title ?? entry.id ?? "mobile-entry").trim();
  const lines = [
    "---",
    `title: ${escapeYaml(title)}`,
    `mobile_entry_id: ${escapeYaml(entry.id ?? "")}`,
    `source_type: ${escapeYaml(entry.type ?? "")}`,
    `source_channel: ${escapeYaml(entry.channel ?? "\u624b\u673a\u7aef")}`,
    entry.sourceName ? `source_name: ${escapeYaml(entry.sourceName)}` : "",
    entry.sourceUrl ? `source_url: ${entry.sourceUrl}` : "",
    `created_at: ${escapeYaml(entry.createdAt ?? now)}`,
    `synced_at: ${escapeYaml(now)}`,
    "---",
    "",
    `# ${title}`,
    "",
    String(entry.text ?? "").trim(),
    formatMedia(mediaFiles),
    "",
  ];
  return lines.filter((line) => line !== "").join("\n");
}

function formatMedia(mediaFiles) {
  if (!Array.isArray(mediaFiles) || mediaFiles.length === 0) return "";
  return ["", "### \u9644\u4ef6", ...mediaFiles.map((file) => {
    const text = typeof file === "string" ? file : file.path;
    if (isImagePath(text)) return `![\u56fe\u7247\u9644\u4ef6](${text})`;
    return `- [\u5a92\u4f53\u9644\u4ef6](${text})`;
  })].join("\n");
}

function isImagePath(value) {
  return /\.(png|jpe?g|gif|webp|bmp|svg)(\?|#|$)/i.test(value);
}

function getEntryDate(entry, now) {
  const value = entry.targetDate ?? entry.createdAt ?? now;
  const text = String(value);
  if (entry.targetDate && /^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  if (entry.createdAt) return formatChinaDateTime(entry.createdAt, now).date;
  return formatChinaDateTime(now).date;
}

function formatChinaDateTime(value, fallback = new Date().toISOString()) {
  const date = new Date(value);
  const valid = Number.isNaN(date.getTime()) ? new Date(fallback) : date;
  const parts = Object.fromEntries(
    CHINA_DATE_TIME_FORMATTER.formatToParts(valid).map((part) => [part.type, part.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}:${parts.second}`,
  };
}

function isUtcLikeTimestamp(value) {
  return /(?:Z|[+-]00:?00)$/i.test(String(value ?? "").trim());
}

function escapeYaml(value) {
  return JSON.stringify(String(value));
}
